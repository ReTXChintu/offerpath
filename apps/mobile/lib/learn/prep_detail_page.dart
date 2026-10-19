import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/interview_prep.dart';
import '../services/api_client.dart';
import '../state/auth_controller.dart';
import '../state/interview_prep_controller.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'prep_practice_page.dart';
import 'prep_widgets.dart';
import 'ui.dart';
import 'voice.dart';

/// Opens one prep's screen (from a list, Today, or a notification).
Future<void> openPrep(BuildContext context, String prepId) async {
  final api = context.read<AuthController>().api;
  if (api == null) return;
  final preps = Provider.of<InterviewPrepController?>(context, listen: false);
  await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PrepDetailPage(api: api, prepId: prepId, preps: preps)));
}

/// One interview being prepared for. While AI writes it, the screen says so
/// and refreshes by itself (polling, and at once on the hub's `changed`
/// frame); a failure shows why with "Try again"; once ready, the summary,
/// focus areas, day-by-day schedule and the questions by kind, each one
/// practised on its own screen. The date and time can be changed, and the
/// prep deleted.
class PrepDetailPage extends StatefulWidget {
  const PrepDetailPage({required this.api, required this.prepId, this.preps, this.voice, this.pollEvery = const Duration(seconds: 5), super.key});

  final ApiClient api;
  final String prepId;

  /// The shared list: kept up to date from here, and its `changes` stream
  /// refreshes this screen.
  final InterviewPrepController? preps;
  final VoiceInput? voice;
  final Duration pollEvery;

  @override
  State<PrepDetailPage> createState() => _PrepDetailPageState();
}

class _PrepDetailPageState extends State<PrepDetailPage> {
  Prep? _prep;
  Object? _loadError;
  bool _busy = false;
  bool _loading = false;
  Timer? _poll;
  StreamSubscription<void>? _changesSub;

  @override
  void initState() {
    super.initState();
    _changesSub = widget.preps?.changes.listen((_) => _load());
    _load();
  }

  @override
  void dispose() {
    _poll?.cancel();
    _changesSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    if (_loading) return;
    _loading = true;
    _poll?.cancel();
    try {
      final prep = await widget.api.getPrep(widget.prepId);
      if (!mounted) return;
      setState(() {
        _prep = prep;
        _loadError = null;
      });
      widget.preps?.put(prep);
    } catch (error) {
      if (mounted) setState(() => _loadError = error);
    } finally {
      _loading = false;
      _schedulePoll();
    }
  }

  /// While AI writes the plan, check again every few seconds (the hub frame
  /// usually gets here first).
  void _schedulePoll() {
    _poll?.cancel();
    if (!mounted || _prep == null || !_prep!.isGenerating) return;
    _poll = Timer(widget.pollEvery, _load);
  }

  void _show(Prep prep) {
    setState(() => _prep = prep);
    widget.preps?.put(prep);
    _schedulePoll();
  }

  Future<void> _regenerate() async {
    setState(() => _busy = true);
    try {
      _show(await widget.api.regeneratePrep(widget.prepId));
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(prepErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _edit() async {
    final prep = _prep;
    if (prep == null) return;
    final edit = await showModalBottomSheet<_PrepEdit>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _EditSheet(prep: prep),
    );
    if (edit == null || !mounted) return;
    setState(() => _busy = true);
    try {
      _show(await widget.api.updatePrep(prep.id, company: edit.company, role: edit.role, scheduledAt: edit.scheduledAt));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Saved.')));
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(prepErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(context, title: 'Delete this prep?', message: 'The plan, the questions and your practice answers go with it.', confirm: 'Delete');
    if (!ok || !mounted) return;
    setState(() => _busy = true);
    try {
      await widget.api.deletePrep(widget.prepId);
      widget.preps?.removeLocal(widget.prepId);
      if (mounted) Navigator.of(context).pop();
    } catch (error) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(prepErrorMessage(error))));
      }
    }
  }

  Future<void> _practise(PrepQuestion question) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => PrepPracticePage(
        api: widget.api,
        prepId: widget.prepId,
        question: question,
        voice: widget.voice,
        onAnswered: (graded) {
          final prep = _prep;
          if (prep != null && mounted) _show(prep.withQuestion(graded));
        },
      ),
    ));
  }

  @override
  Widget build(BuildContext context) {
    final prep = _prep;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Interview prep'),
        actions: [
          if (prep != null) ...[
            IconButton(onPressed: _busy ? null : _edit, icon: const Icon(Icons.edit_calendar_outlined), tooltip: 'Edit date and time'),
            IconButton(onPressed: _busy ? null : _delete, icon: const Icon(Icons.delete_outline), tooltip: 'Delete'),
          ],
        ],
      ),
      body: prep == null
          ? (_loadError == null
              ? const Center(child: CircularProgressIndicator())
              : RefreshIndicator(
                  onRefresh: _load,
                  child: LearnMessage(
                    icon: Icons.error_outline,
                    title: 'Could not load this prep',
                    body: _loadError is ApiException && (_loadError as ApiException).status == 404 ? 'It may have been deleted.' : prepErrorMessage(_loadError),
                    action: 'Try again',
                    onAction: _load,
                  ),
                ))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
                children: [
                  _Header(prep: prep),
                  if (prep.isGenerating) _generating(context),
                  if (prep.isFailed) _failed(context, prep),
                  if (prep.isReady) ..._ready(context, prep),
                ],
              ),
            ),
    );
  }

  Widget _generating(BuildContext context) => Callout(
        icon: Icons.auto_awesome_outlined,
        color: Theme.of(context).colorScheme.primary,
        title: 'Writing your plan and questions…',
        message: "This takes a minute or two. You'll get a notification when it's ready, and this page updates by itself. "
            'If your laptop is offline and no OpenAI key is saved, it starts when your laptop comes online.',
        child: const LinearProgressIndicator(),
      );

  Widget _failed(BuildContext context, Prep prep) {
    final color = Theme.of(context).colorScheme.error;
    return Callout(
      icon: Icons.error_outline,
      color: color,
      title: 'Could not prepare this interview',
      message: prep.error ?? 'Something went wrong while writing the plan.',
      child: Align(
        alignment: Alignment.centerLeft,
        child: FilledButton.icon(
          onPressed: _busy ? null : _regenerate,
          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.refresh),
          label: const Text('Try again'),
        ),
      ),
    );
  }

  List<Widget> _ready(BuildContext context, Prep prep) {
    final tone = LearnTone.of(context);
    final plan = prep.plan;
    final progress = prep.progress;
    return [
      const SizedBox(height: 14),
      LearnPanel(
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${progress.answered} of ${progress.total} practised', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: tone.strong)),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(value: progress.total == 0 ? 0 : progress.answered / progress.total, minHeight: 5),
              ),
            ]),
          ),
          const SizedBox(width: 16),
          Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Text(
              progress.averageScore == null ? '—' : formatPrepScore(progress.averageScore!),
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: progress.averageScore == null ? tone.muted : prepScoreColor(context, progress.averageScore!)),
            ),
            Text('average', style: TextStyle(fontSize: 11, color: tone.muted)),
          ]),
        ]),
      ),
      if (plan != null && plan.summary.isNotEmpty) ...[
        const SizedBox(height: 22),
        const SectionLabel('What to expect'),
        Text(plan.summary, style: TextStyle(fontSize: 14, color: tone.body, height: 1.6)),
      ],
      if (plan != null && plan.focusAreas.isNotEmpty) ...[
        const SizedBox(height: 22),
        const SectionLabel('Focus areas'),
        for (final area in plan.focusAreas) _FocusRow(area: area),
      ],
      if (plan != null && plan.schedule.isNotEmpty) ...[
        const SizedBox(height: 22),
        const SectionLabel('Day by day'),
        LearnPanel(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
          child: Column(children: [for (final day in plan.schedule) _DayRow(day: day, scheduledAt: prep.scheduledAt, total: plan.schedule.length)]),
        ),
      ],
      for (final (kind, questions) in prep.questionsByKind) ...[
        const SizedBox(height: 22),
        SectionLabel('${prepKindLabel(kind)} · ${questions.length}'),
        for (final q in questions) _QuestionCard(question: q, onTap: () => _practise(q)),
      ],
    ];
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.prep});

  final Prep prep;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final color = prepStatusColor(context, prep.status);
    final source = switch (prep.generatedBy) {
      PrepAiSource.desktop => 'Written by Claude on your laptop',
      PrepAiSource.openai => 'Written with your OpenAI key',
      null => null,
    };
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(prep.title, style: TextStyle(fontSize: 21, fontWeight: FontWeight.w800, color: tone.strong, height: 1.25)),
      const SizedBox(height: 6),
      Wrap(spacing: 6, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
        Tag(formatDateTime(context, prep.scheduledAt), color: tone.accent, icon: Icons.event),
        Tag(prepCountdown(prep.scheduledAt), color: tone.accent, icon: Icons.timer_outlined),
        Tag(prepStatusLabel(prep.status), color: color),
      ]),
      if (prep.technologies.isNotEmpty) ...[
        const SizedBox(height: 10),
        Wrap(spacing: 6, runSpacing: 6, children: [for (final t in prep.technologies) Tag(t, color: tone.muted)]),
      ],
      if (source != null) ...[
        const SizedBox(height: 8),
        Text(source, style: TextStyle(fontSize: 12, color: tone.muted)),
      ],
    ]);
  }
}

class _FocusRow extends StatelessWidget {
  const _FocusRow({required this.area});

  final PrepFocusArea area;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final color = switch (area.priority) { 1 => tone.fail, 2 => LearnTone.warn, _ => tone.muted };
    final label = switch (area.priority) { 1 => 'High', 2 => 'Medium', _ => 'Low' };
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: tone.card, border: Border.all(color: tone.line), borderRadius: BorderRadius.circular(12)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: Text(area.topic, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: tone.strong))),
          Tag(label, color: color),
        ]),
        if (area.why.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(area.why, style: TextStyle(fontSize: 13, color: tone.muted, height: 1.45)),
        ],
      ]),
    );
  }
}

class _DayRow extends StatelessWidget {
  const _DayRow({required this.day, required this.scheduledAt, required this.total});

  final PrepScheduleDay day;
  final DateTime scheduledAt;
  final int total;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    // Day N of the plan, counted back from the interview (the last day is
    // the day before it).
    final local = scheduledAt.toLocal();
    final date = DateTime(local.year, local.month, local.day).subtract(Duration(days: total - day.day + 1));
    final now = DateTime.now();
    final isToday = date.year == now.year && date.month == now.month && date.day == now.day;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(
          width: 64,
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Day ${day.day}', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: isToday ? tone.accent : tone.strong)),
            Text(isToday ? 'today' : MaterialLocalizations.of(context).formatShortMonthDay(date), style: TextStyle(fontSize: 11, color: isToday ? tone.accent : tone.muted)),
          ]),
        ),
        Expanded(child: Text(day.focus, style: TextStyle(fontSize: 14, color: tone.body, height: 1.45))),
      ]),
    );
  }
}

class _QuestionCard extends StatelessWidget {
  const _QuestionCard({required this.question, required this.onTap});

  final PrepQuestion question;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final score = question.score;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: tone.card,
        shape: RoundedRectangleBorder(side: BorderSide(color: tone.line), borderRadius: BorderRadius.circular(12)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 8, 12),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  if (question.topic.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Text('${question.topic.toUpperCase()} · ${'●' * question.difficulty.clamp(1, 5)}', style: TextStyle(fontSize: 10, letterSpacing: 0.6, color: tone.muted)),
                    ),
                  Text(question.question, style: TextStyle(fontSize: 14, color: tone.strong, height: 1.45)),
                ]),
              ),
              const SizedBox(width: 10),
              score == null
                  ? Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text('Practise', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: tone.accent)),
                    )
                  : Text(formatPrepScore(score), style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: prepScoreColor(context, score))),
              Icon(Icons.chevron_right, size: 20, color: tone.muted),
            ]),
          ),
        ),
      ),
    );
  }
}

class _PrepEdit {
  const _PrepEdit({required this.company, required this.role, required this.scheduledAt});
  final String company;
  final String role;
  final DateTime scheduledAt;
}

/// Company, role and the interview's date and time.
class _EditSheet extends StatefulWidget {
  const _EditSheet({required this.prep});

  final Prep prep;

  @override
  State<_EditSheet> createState() => _EditSheetState();
}

class _EditSheetState extends State<_EditSheet> {
  late final _company = TextEditingController(text: widget.prep.company ?? '');
  late final _role = TextEditingController(text: widget.prep.role ?? '');
  late final DateTime _local = widget.prep.scheduledAt.toLocal();
  late DateTime _date = DateTime(_local.year, _local.month, _local.day);
  late TimeOfDay _time = TimeOfDay(hour: _local.hour, minute: _local.minute);
  String? _error;

  @override
  void dispose() {
    _company.dispose();
    _role.dispose();
    super.dispose();
  }

  void _save() {
    if (_company.text.trim().length > 120 || _role.text.trim().length > 120) {
      setState(() => _error = 'Keep the company and role under 120 characters.');
      return;
    }
    final at = DateTime(_date.year, _date.month, _date.day, _time.hour, _time.minute);
    Navigator.of(context).pop(_PrepEdit(company: _company.text, role: _role.text, scheduledAt: at));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, MediaQuery.viewInsetsOf(context).bottom + 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Edit interview', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 16),
          TextField(controller: _company, decoration: const InputDecoration(labelText: 'Company'), textCapitalization: TextCapitalization.words),
          const SizedBox(height: 12),
          TextField(controller: _role, decoration: const InputDecoration(labelText: 'Role'), textCapitalization: TextCapitalization.sentences),
          const SizedBox(height: 16),
          PrepWhenFields(date: _date, time: _time, onDate: (d) => setState(() => _date = d), onTime: (t) => setState(() => _time = t)),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
          ],
          const SizedBox(height: 20),
          FilledButton(onPressed: _save, child: const Text('Save')),
        ],
      ),
    );
  }
}
