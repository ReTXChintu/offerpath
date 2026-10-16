import 'package:flutter/material.dart';

import '../services/api_client.dart';
import 'models.dart';
import 'ui.dart';

/// Spaced recall, ported from ForgeRoutine's recall sheet.
///
/// **Where a prompt appears is a product rule, not a presentation choice.**
/// Only at boundaries: after a routine item is finished, or when the user
/// opens their reviews (Learn > Recall). Never mid-task: an interruption
/// teaches people to dismiss prompts unread, and then every schedule built
/// on the answers is wrong.
Future<void> showRecallPrompt(BuildContext context, {required ApiClient api, required RecallPrompt prompt}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 20, bottom: MediaQuery.of(sheetContext).viewInsets.bottom + 24),
      child: SingleChildScrollView(
        child: RecallCard(api: api, prompt: prompt, onContinue: () => Navigator.of(sheetContext).pop()),
      ),
    ),
  );
}

/// One recall question: tap an option, see whether it was right, why, and
/// when it comes round again.
class RecallCard extends StatefulWidget {
  const RecallCard({required this.api, required this.prompt, required this.onContinue, this.continueLabel = 'Continue', super.key});

  final ApiClient api;
  final RecallPrompt prompt;
  final VoidCallback onContinue;
  final String continueLabel;

  @override
  State<RecallCard> createState() => _RecallCardState();
}

class _RecallCardState extends State<RecallCard> {
  int? _selected;
  RecallAnswer? _result;
  bool _busy = false;
  String? _error;

  Future<void> _answer(int index) async {
    if (_busy || _result != null) return;
    setState(() {
      _selected = index;
      _busy = true;
      _error = null;
    });
    try {
      final json = await widget.api.post('/recall/answer', body: {'questionId': widget.prompt.id, 'selectedIndex': index});
      if (mounted) setState(() => _result = RecallAnswer.fromJson((json as Map).cast<String, dynamic>()));
    } catch (e) {
      if (mounted) {
        setState(() {
          _selected = null;
          _error = learnErrorMessage(e);
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final result = _result;
    final prompt = widget.prompt;

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
            decoration: BoxDecoration(color: tone.raised, border: Border.all(color: tone.line), borderRadius: BorderRadius.circular(6)),
            child: Text('Recall', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: tone.muted)),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              [prompt.technologyName, prompt.conceptName].where((s) => s.isNotEmpty).join(' · '),
              style: TextStyle(fontSize: 12, color: tone.muted),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ]),
        const SizedBox(height: 14),
        Text(prompt.prompt, style: TextStyle(fontSize: 16, color: tone.strong, height: 1.5)),
        const SizedBox(height: 18),
        for (var index = 0; index < prompt.options.length; index += 1)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _Option(
              label: prompt.options[index],
              // Nothing is coloured until an answer is committed, so the right
              // option cannot be read off the styling.
              state: result == null
                  ? _OptionState.pending
                  : result.correctIndex == index
                      ? _OptionState.correct
                      : _selected == index
                          ? _OptionState.wrong
                          : _OptionState.neutral,
              busy: _busy && _selected == index,
              onTap: () => _answer(index),
            ),
          ),
        if (_error != null) ...[
          const SizedBox(height: 4),
          Text(_error!, style: TextStyle(color: tone.fail, fontSize: 13)),
        ],
        if (result != null) ...[
          const SizedBox(height: 10),
          Divider(color: tone.line, height: 24),
          // Shown either way: being right for the wrong reason is still worth
          // correcting, and the explanation is where the learning is.
          Text(result.explanation, style: TextStyle(fontSize: 14, color: tone.body, height: 1.6)),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(child: Text('Next review ${describeDue(result.nextDueAt)}', style: TextStyle(fontSize: 12, color: tone.muted))),
              FilledButton(onPressed: widget.onContinue, child: Text(widget.continueLabel)),
            ],
          ),
        ],
      ],
    );
  }
}

enum _OptionState { pending, correct, wrong, neutral }

class _Option extends StatelessWidget {
  const _Option({required this.label, required this.state, required this.busy, required this.onTap});

  final String label;
  final _OptionState state;
  final bool busy;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final border = switch (state) {
      _OptionState.correct => LearnTone.pass,
      _OptionState.wrong => tone.fail,
      _ => tone.line,
    };
    return Material(
      color: tone.card,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        onTap: state == _OptionState.pending ? onTap : null,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
          decoration: BoxDecoration(border: Border.all(color: border, width: state == _OptionState.pending || state == _OptionState.neutral ? 1 : 2), borderRadius: BorderRadius.circular(10)),
          child: Row(children: [
            if (state == _OptionState.correct) const Icon(Icons.check, size: 18, color: LearnTone.pass),
            if (state == _OptionState.wrong) Icon(Icons.close, size: 18, color: tone.fail),
            if (busy) const SizedBox(height: 14, width: 14, child: CircularProgressIndicator(strokeWidth: 2)),
            if (state == _OptionState.correct || state == _OptionState.wrong || busy) const SizedBox(width: 8),
            Expanded(
              child: Text(label, style: TextStyle(fontSize: 14, color: state == _OptionState.neutral ? tone.muted : tone.strong, height: 1.4)),
            ),
          ]),
        ),
      ),
    );
  }
}

String describeDue(DateTime due, {DateTime? now}) {
  final days = due.difference(now ?? DateTime.now()).inDays;
  if (days <= 0) return 'today';
  if (days == 1) return 'tomorrow';
  if (days < 30) return 'in $days days';
  return 'in ${(days / 30).round()} months';
}

/// Learn > Recall: everything due, as flashcards, one at a time.
class RecallPage extends StatefulWidget {
  const RecallPage({required this.api, super.key});

  final ApiClient api;

  @override
  State<RecallPage> createState() => _RecallPageState();
}

class _RecallPageState extends State<RecallPage> {
  late Future<List<RecallPrompt>> _due = _load();
  int _index = 0;
  int _answered = 0;

  Future<List<RecallPrompt>> _load() async {
    final json = await widget.api.get('/recall/due');
    return (json as List<dynamic>? ?? const []).map((e) => RecallPrompt.fromJson((e as Map).cast<String, dynamic>())).toList();
  }

  Future<void> _refresh() async {
    setState(() {
      _index = 0;
      _answered = 0;
      _due = _load();
    });
    try {
      await _due;
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: FutureBuilder<List<RecallPrompt>>(
        future: _due,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) return LearnErrorView(title: 'Could not load your reviews', error: snapshot.error, onRetry: _refresh);
          final due = snapshot.data ?? const [];
          if (due.isEmpty) {
            return const LearnMessage(
              icon: Icons.check_circle_outline,
              title: 'Nothing due',
              body: 'Reviews come round on a schedule: come back when something is due. Missing a day costs nothing.',
            );
          }
          if (_index >= due.length) {
            return LearnMessage(
              icon: Icons.done_all,
              title: 'Reviews done',
              body: 'You went through $_answered card${_answered == 1 ? '' : 's'}. Each comes back when it starts to fade.',
              action: 'Check again',
              onAction: _refresh,
            );
          }
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              Text('Card ${_index + 1} of ${due.length}', style: TextStyle(fontSize: 12, color: tone.muted)),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(99),
                child: LinearProgressIndicator(value: _index / due.length, minHeight: 4),
              ),
              const SizedBox(height: 16),
              LearnPanel(
                child: RecallCard(
                  key: ValueKey(due[_index].id),
                  api: widget.api,
                  prompt: due[_index],
                  continueLabel: _index + 1 < due.length ? 'Next card' : 'Finish',
                  onContinue: () => setState(() {
                    _index += 1;
                    _answered += 1;
                  }),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
