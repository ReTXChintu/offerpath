import 'package:flutter/material.dart';

import '../services/api_client.dart';
import 'concept_page.dart';
import 'models.dart';
import 'recall.dart';
import 'ui.dart';

/// Today's routine, ported from ForgeRoutine's app.
///
/// The same slice of the roadmap the desktop and web show, with the same
/// rules: due reviews first, every item carries the reason it is there, and
/// the list is never padded to fill the time.
///
/// What is different is what you can finish here. Reading, recall and spoken
/// interviews work on a phone; writing code does not, so those items show
/// their reason and say they're desk work rather than opening an editor
/// nobody can use one-handed.
class RoutinePage extends StatefulWidget {
  const RoutinePage({required this.api, this.onOpenInterviews, super.key});

  final ApiClient api;

  /// Opens Learn > Interviews (for INTERVIEW items).
  final VoidCallback? onOpenInterviews;

  @override
  State<RoutinePage> createState() => _RoutinePageState();
}

class _RoutinePageState extends State<RoutinePage> {
  late Future<Routine?> _routine = _load();
  String? _actionError;

  Future<Routine?> _load() async {
    final json = await widget.api.get('/routines/today');
    // An empty body means no routine planned yet, not an empty routine.
    if (json is! Map || json.isEmpty) return null;
    return Routine.fromJson(json.cast<String, dynamic>());
  }

  Future<void> _refresh() async {
    setState(() {
      _actionError = null;
      _routine = _load();
    });
    try {
      await _routine;
    } catch (_) {}
  }

  Future<void> _act(Future<void> Function() body) async {
    try {
      await body();
    } catch (e) {
      if (mounted) setState(() => _actionError = learnErrorMessage(e));
    }
  }

  Future<void> _generate({bool force = false}) => _act(() async {
        final json = await widget.api.post(force ? '/routines/regenerate' : '/routines/generate', timeout: ApiClient.aiTimeout);
        if (mounted) setState(() => _routine = Future.value(Routine.fromJson((json as Map).cast<String, dynamic>())));
      });

  /// Completing an item is a boundary, which is the one safe moment to ask a
  /// recall question.
  Future<void> _complete(RoutineItem item) => _act(() async {
        await widget.api.patch('/routines/items/${item.id}', body: {'status': 'DONE'});
        if (!mounted) return;
        await _refresh();
        if (!mounted) return;
        final due = await widget.api.get('/recall/due');
        if (!mounted || due is! List || due.isEmpty) return;
        await showRecallPrompt(context, api: widget.api, prompt: RecallPrompt.fromJson((due.first as Map).cast<String, dynamic>()));
      });

  Future<void> _skip(RoutineItem item) => _act(() async {
        await widget.api.patch('/routines/items/${item.id}', body: {'status': 'SKIPPED'});
        await _refresh();
      });

  void _open(RoutineItem item) {
    if (item.kind == 'INTERVIEW') {
      widget.onOpenInterviews?.call();
      return;
    }
    final conceptId = item.conceptId;
    if (conceptId == null) return;
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ConceptPage(api: widget.api, conceptId: conceptId, title: item.title)));
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: FutureBuilder<Routine?>(
        future: _routine,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) return LearnErrorView(title: 'Could not load today', error: snapshot.error, onRetry: _refresh);

          final routine = snapshot.data;
          if (routine == null) {
            return LearnMessage(
              title: 'Nothing planned yet',
              body: _actionError ?? "Today's work is a slice of your roadmap, weighted towards anything due for review.",
              action: 'Plan today',
              onAction: _generate,
            );
          }

          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              _Header(routine: routine, onReplan: () => _generate(force: true)),
              if (_actionError != null) ...[
                const SizedBox(height: 12),
                Text(_actionError!, style: TextStyle(color: tone.fail, fontSize: 13)),
              ],
              const SizedBox(height: 16),
              for (final item in routine.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: _ItemCard(
                    item: item,
                    onOpen: (item.kind == 'INTERVIEW' && widget.onOpenInterviews != null) || (item.conceptId != null && !item.requiresDesktop) ? () => _open(item) : null,
                    onComplete: () => _complete(item),
                    onSkip: () => _skip(item),
                  ),
                ),
              if (routine.isFinished) ...[
                const SizedBox(height: 24),
                Text('That is today’s work done.', textAlign: TextAlign.center, style: TextStyle(color: tone.body, fontSize: 14)),
                const SizedBox(height: 4),
                // No confetti and no streak counter. Finishing is the reward;
                // a celebration loop trains people to chase the animation.
                Text(
                  'Stopping here is the right call — tomorrow’s spacing depends on it.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: tone.muted, fontSize: 12, height: 1.5),
                ),
              ],
            ],
          );
        },
      ),
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.routine, required this.onReplan});

  final Routine routine;
  final VoidCallback onReplan;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text("Today's routine", style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: tone.strong)),
            TextButton(onPressed: onReplan, child: const Text('Replan')),
          ],
        ),
        Text(
          '${routine.completedMinutes} of ${routine.totalMinutes} minutes'
          '${routine.recallDue > 0 ? ' · ${routine.recallDue} due for review' : ''}',
          style: TextStyle(fontSize: 13, color: tone.muted),
        ),
        const SizedBox(height: 12),
        ClipRRect(
          borderRadius: BorderRadius.circular(99),
          child: LinearProgressIndicator(
            value: routine.progress,
            minHeight: 5,
            valueColor: AlwaysStoppedAnimation<Color>(routine.progress >= 1 ? LearnTone.pass : tone.accent),
          ),
        ),
      ],
    );
  }
}

const _kindLabels = <String, String>{
  'LEARN': 'Read',
  'RECALL': 'Recall',
  'CODE': 'Write',
  'BLIND_CODE': 'Blind',
  'DEBUG': 'Debug',
  'EXPLAIN': 'Explain',
  'PROJECT': 'Project',
  'CHECKPOINT': 'Checkpoint',
  'REVIEW': 'Review',
  'INTERVIEW': 'Interview',
};

class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.item, required this.onOpen, required this.onComplete, required this.onSkip});

  final RoutineItem item;
  final VoidCallback? onOpen;
  final VoidCallback onComplete;
  final VoidCallback onSkip;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final settled = item.isDone || item.isSkipped;

    return Opacity(
      opacity: settled ? 0.55 : 1,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: item.isDone ? Colors.transparent : tone.card,
          border: Border.all(color: tone.line),
          borderRadius: BorderRadius.circular(14),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                  decoration: BoxDecoration(color: tone.raised, border: Border.all(color: tone.line), borderRadius: BorderRadius.circular(6)),
                  child: Text(_kindLabels[item.kind] ?? item.kind, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: tone.muted)),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    item.title,
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: tone.strong, decoration: settled ? TextDecoration.lineThrough : null),
                  ),
                ),
                Text('${item.minutes}m', style: TextStyle(fontSize: 12, color: tone.muted)),
              ],
            ),
            const SizedBox(height: 6),
            // The reason is always shown. An opaque routine is not a trusted
            // one, and on a phone there is no room to go and check the roadmap.
            Text(item.rationale, style: TextStyle(fontSize: 13, color: tone.muted, height: 1.4)),
            if (item.requiresDesktop && !settled) ...[
              const SizedBox(height: 8),
              Row(children: [
                Icon(Icons.desktop_windows_outlined, size: 14, color: tone.muted),
                const SizedBox(width: 6),
                Expanded(child: Text('Writing code happens at a desk. Open this on your desktop or the web.', style: TextStyle(fontSize: 12, color: tone.muted))),
              ]),
            ],
            if (!settled) ...[
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (onOpen != null) TextButton(onPressed: onOpen, child: Text(item.kind == 'INTERVIEW' ? 'Start' : 'Read')),
                  const Spacer(),
                  TextButton(onPressed: onSkip, child: Text('Skip', style: TextStyle(color: tone.muted))),
                  const SizedBox(width: 4),
                  FilledButton.tonal(onPressed: onComplete, child: const Text('Done')),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
