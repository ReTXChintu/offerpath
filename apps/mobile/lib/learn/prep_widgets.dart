import 'package:flutter/material.dart';

import '../models/interview_prep.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'ui.dart';

/// "7/10" or "7.5/10".
String formatPrepScore(double score) => '${score == score.roundToDouble() ? score.toInt() : score.toStringAsFixed(1)}/10';

/// The colour for a 0-10 score.
Color prepScoreColor(BuildContext context, double score) => score >= 7 ? LearnTone.pass : (score >= 4.5 ? LearnTone.warn : LearnTone.of(context).fail);

/// The colour for a prep's status.
Color prepStatusColor(BuildContext context, PrepStatus status) => switch (status) {
      PrepStatus.ready => LearnTone.pass,
      PrepStatus.failed => Theme.of(context).colorScheme.error,
      PrepStatus.generating => Theme.of(context).colorScheme.primary,
    };

/// One prep in a list (Learn > Interview prep, and Today): what, when, how
/// long until, and how far the practice has got.
class PrepTile extends StatelessWidget {
  const PrepTile({required this.prep, required this.onTap, this.now, super.key});

  final Prep prep;
  final VoidCallback onTap;

  /// For tests.
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final color = prepStatusColor(context, prep.status);
    final progress = prep.progress;
    final String line = switch (prep.status) {
      PrepStatus.generating => 'Writing your plan and questions…',
      PrepStatus.failed => 'Could not prepare it. Open to try again.',
      PrepStatus.ready => progress.total == 0
          ? 'Ready'
          : '${progress.answered} of ${progress.total} practised${progress.averageScore == null ? '' : ' · average ${formatPrepScore(progress.averageScore!)}'}',
    };
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.fromLTRB(14, 12, 10, 12),
      child: Row(children: [
        IconBubble(
          switch (prep.status) { PrepStatus.ready => Icons.event_available_outlined, PrepStatus.failed => Icons.error_outline, PrepStatus.generating => Icons.hourglass_top },
          color: color,
          size: 38,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Expanded(child: Text(prep.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700))),
              const SizedBox(width: 6),
              Tag(prepStatusLabel(prep.status), color: color),
            ]),
            const SizedBox(height: 2),
            Text(
              '${formatDateTime(context, prep.scheduledAt)} · ${prepCountdown(prep.scheduledAt, now: now)}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.bodySmall?.copyWith(color: muted),
            ),
            const SizedBox(height: 2),
            Text(line, maxLines: 1, overflow: TextOverflow.ellipsis, style: theme.textTheme.bodySmall?.copyWith(color: prep.isFailed ? color : muted)),
            if (prep.isReady && progress.total > 0) ...[
              const SizedBox(height: 6),
              ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: progress.answered / progress.total, minHeight: 4)),
            ],
            if (prep.isGenerating) ...[
              const SizedBox(height: 6),
              ClipRRect(borderRadius: BorderRadius.circular(4), child: const LinearProgressIndicator(minHeight: 4)),
            ],
          ]),
        ),
        Icon(Icons.chevron_right, color: muted),
      ]),
    );
  }
}

/// Interview date and time, picked separately, in local time.
class PrepWhenFields extends StatelessWidget {
  const PrepWhenFields({required this.date, required this.time, required this.onDate, required this.onTime, this.dateError, this.timeError, super.key});

  final DateTime? date;
  final TimeOfDay? time;
  final ValueChanged<DateTime> onDate;
  final ValueChanged<TimeOfDay> onTime;
  final String? dateError;
  final String? timeError;

  Future<void> _pickDate(BuildContext context) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final initial = date ?? today.add(const Duration(days: 1));
    final picked = await showDatePicker(
      context: context,
      initialDate: initial.isBefore(today) ? today : initial,
      firstDate: initial.isBefore(today) ? initial : today,
      lastDate: today.add(const Duration(days: 365)),
      helpText: 'Interview date',
    );
    if (picked != null) onDate(picked);
  }

  Future<void> _pickTime(BuildContext context) async {
    final picked = await showTimePicker(context: context, initialTime: time ?? const TimeOfDay(hour: 10, minute: 0), helpText: 'Interview time');
    if (picked != null) onTime(picked);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final localizations = MaterialLocalizations.of(context);
    Widget field({required String label, required String? value, required IconData icon, required VoidCallback onTap, String? error}) => Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            OutlinedButton.icon(
              onPressed: onTap,
              icon: Icon(icon, size: 18),
              label: Text(value ?? label, overflow: TextOverflow.ellipsis),
              style: OutlinedButton.styleFrom(
                alignment: Alignment.centerLeft,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
                side: error == null ? null : BorderSide(color: theme.colorScheme.error),
              ),
            ),
            if (error != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(4, 4, 4, 0),
                child: Text(error, style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.error)),
              ),
          ]),
        );
    return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
      field(label: 'Pick date', value: date == null ? null : localizations.formatMediumDate(date!), icon: Icons.calendar_today_outlined, onTap: () => _pickDate(context), error: dateError),
      const SizedBox(width: 10),
      field(label: 'Pick time', value: time?.format(context), icon: Icons.schedule, onTap: () => _pickTime(context), error: timeError),
    ]);
  }
}

/// A bulleted list in one colour (covered, missed, key points).
class PrepPoints extends StatelessWidget {
  const PrepPoints(this.items, {this.icon, this.color, super.key});

  final List<String> items;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final item in items)
          Padding(
            padding: const EdgeInsets.only(bottom: 6),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Padding(padding: const EdgeInsets.only(top: 2), child: Icon(icon ?? Icons.circle, size: icon == null ? 6 : 16, color: color ?? tone.muted)),
              const SizedBox(width: 8),
              Expanded(child: Text(item, style: TextStyle(fontSize: 14, color: tone.body, height: 1.45))),
            ]),
          ),
      ],
    );
  }
}
