import 'package:flutter/material.dart';

import '../services/api_client.dart';
import 'interview_session_page.dart';
import 'models.dart';
import 'ui.dart';

/// Learn > Interviews: the readiness guide, past mock interviews, and a way
/// to start a spoken one. Ported from ForgeRoutine's app.
///
/// The guide answers "if the interview were tomorrow, where would I be caught
/// out", ordered by preparation value.
class InterviewPage extends StatefulWidget {
  const InterviewPage({required this.api, super.key});

  final ApiClient api;

  @override
  State<InterviewPage> createState() => _InterviewPageState();
}

class _InterviewPageState extends State<InterviewPage> {
  late Future<(InterviewGuide, List<InterviewSummary>)> _data = _load();

  String _mode = 'QUICK';
  bool _starting = false;

  Future<(InterviewGuide, List<InterviewSummary>)> _load() async {
    final guide = await widget.api.get('/interviews/guide');
    final history = await widget.api.get('/interviews');
    return (
      InterviewGuide.fromJson((guide as Map).cast<String, dynamic>()),
      (history as List<dynamic>? ?? const []).map((e) => InterviewSummary.fromJson((e as Map).cast<String, dynamic>())).toList(),
    );
  }

  Future<void> _refresh() async {
    setState(() => _data = _load());
    try {
      await _data;
    } catch (_) {}
  }

  Future<void> _start() async {
    if (_starting) return;
    setState(() => _starting = true);
    try {
      final json = await widget.api.post('/interviews', body: {'mode': _mode, 'targetLevel': 'MID'}, timeout: ApiClient.aiTimeout);
      if (!mounted) return;
      await _open(Interview.fromJson((json as Map).cast<String, dynamic>()).id);
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(learnErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _open(String interviewId) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => InterviewSessionPage(api: widget.api, interviewId: interviewId)));
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: FutureBuilder<(InterviewGuide, List<InterviewSummary>)>(
        future: _data,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (!snapshot.hasData) return LearnErrorView(title: 'Could not load interviews', error: snapshot.error, onRetry: _refresh);

          final (guide, history) = snapshot.data!;
          return ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
            children: [
              _ReadinessCard(guide: guide, mode: _mode, starting: _starting, onModeChanged: (mode) => setState(() => _mode = mode), onStart: _start),
              if (guide.priorities.isNotEmpty) ...[
                const SizedBox(height: 24),
                const SectionLabel('Fix these first'),
                for (var index = 0; index < guide.priorities.length; index += 1) _PriorityRow(index: index + 1, priority: guide.priorities[index]),
              ],
              if (guide.recurringWeaknesses.isNotEmpty) ...[
                const SizedBox(height: 24),
                const SectionLabel('Came up more than once'),
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text('Weaknesses two or more past interviews agreed on. One interview is an off day; two is a pattern.', style: TextStyle(fontSize: 12, color: tone.muted, height: 1.5)),
                ),
                for (final weakness in guide.recurringWeaknesses)
                  Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('· $weakness', style: TextStyle(fontSize: 14, color: tone.body, height: 1.5))),
              ],
              if (history.isNotEmpty) ...[
                const SizedBox(height: 24),
                const SectionLabel('Past interviews'),
                for (final interview in history) _HistoryRow(interview: interview, onTap: () => _open(interview.id)),
              ],
            ],
          );
        },
      ),
    );
  }
}

/// The modes a phone offers. Coding and debugging interviews need a
/// keyboard and an editor, so they stay on the desktop and the web.
const interviewModes = <String, String>{
  'QUICK': 'Quick · 3 areas',
  'TECHNICAL': 'Technical · 4 areas',
  'SYSTEM_DESIGN': 'System design · deep',
  'SENIOR': 'Senior · 5 areas, deep',
};

class _ReadinessCard extends StatelessWidget {
  const _ReadinessCard({required this.guide, required this.mode, required this.starting, required this.onModeChanged, required this.onStart});

  final InterviewGuide guide;
  final String mode;
  final bool starting;
  final ValueChanged<String> onModeChanged;
  final VoidCallback onStart;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return LearnPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (guide.overallReadiness != null) ...[
            Text('${(guide.overallReadiness! * 100).round()}%', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: tone.accent, height: 1)),
            const SizedBox(height: 4),
            Text('weighted readiness', style: TextStyle(fontSize: 12, color: tone.muted)),
          ] else ...[
            Text('Not enough yet', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: tone.body)),
            const SizedBox(height: 4),
            // Refusing to give a number is the honest answer; saying why stops
            // it reading as a bug.
            Text('A number from two practised concepts would be a guess.', style: TextStyle(fontSize: 12, color: tone.muted, height: 1.5)),
          ],
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: mode,
            isDense: true,
            decoration: const InputDecoration(labelText: 'Kind of interview'),
            items: [for (final entry in interviewModes.entries) DropdownMenuItem<String>(value: entry.key, child: Text(entry.value))],
            onChanged: (value) => value == null ? null : onModeChanged(value),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: starting ? null : onStart,
            icon: starting ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.mic_none),
            label: const Text('Start interview'),
          ),
          const SizedBox(height: 6),
          Text('Questions come from Claude on your desktop. Answer out loud or type.', style: TextStyle(fontSize: 12, color: tone.muted)),
        ],
      ),
    );
  }
}

class _PriorityRow extends StatelessWidget {
  const _PriorityRow({required this.index, required this.priority});

  final int index;
  final GuidePriority priority;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: tone.card, border: Border.all(color: tone.line), borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(width: 22, child: Text('$index', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: tone.accent))),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(priority.title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: tone.strong)),
              const SizedBox(height: 2),
              Text(priority.reason, style: TextStyle(fontSize: 12, color: tone.muted, height: 1.4)),
            ]),
          ),
        ],
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  const _HistoryRow({required this.interview, required this.onTap});

  final InterviewSummary interview;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final score = interview.overallScore;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(interview.mode.replaceAll('_', ' '), style: TextStyle(fontSize: 14, color: tone.strong)),
              Text('${interview.startedAt.day}/${interview.startedAt.month} · ${interview.questionCount} questions', style: TextStyle(fontSize: 12, color: tone.muted)),
            ]),
          ),
          Text(
            score == null ? (interview.status == 'IN_PROGRESS' ? 'unfinished' : '—') : '${(score * 100).round()}%',
            style: TextStyle(fontSize: 14, color: score == null ? tone.muted : tone.strong),
          ),
        ]),
      ),
    );
  }
}
