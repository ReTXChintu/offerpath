import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../logic/filters.dart';
import '../services/api_client.dart';
import '../state/applications_controller.dart';
import '../state/auth_controller.dart';
import 'models.dart';
import 'ui.dart';

/// More > Progress: the summary the phone shows (plan section 5.1). The
/// Independent Coding Score leads, because it is the number the learning
/// side exists to move; then today, the weakest skills, and the hunt funnel.
///
/// `INSUFFICIENT_DATA` renders as a dash and an explanation, never as 0%.
class ProgressPage extends StatefulWidget {
  const ProgressPage({this.api, super.key});

  /// Defaults to the signed-in client.
  final ApiClient? api;

  @override
  State<ProgressPage> createState() => _ProgressPageState();
}

class _ProgressPageState extends State<ProgressPage> {
  late final ApiClient? _api = widget.api ?? context.read<AuthController>().api;
  late Future<DashboardOverview> _overview = _load();

  Future<DashboardOverview> _load() async {
    final api = _api;
    if (api == null) throw const ApiException(status: 401, type: 'unauthorized', title: 'Not signed in.');
    return DashboardOverview.fromJson(((await api.get('/progress/overview')) as Map).cast<String, dynamic>());
  }

  Future<void> _refresh() async {
    setState(() => _overview = _load());
    try {
      await _overview;
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Progress')),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<DashboardOverview>(
          future: _overview,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
            if (!snapshot.hasData) return LearnErrorView(title: 'Could not load your progress', error: snapshot.error, onRetry: _refresh);
            final data = snapshot.data!;
            return ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                Text(data.greeting, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 16),
                IndependenceCard(score: data.independence),
                const SizedBox(height: 12),
                _TodayCard(done: data.todayMinutesDone, target: data.todayMinutesTarget, readiness: data.interviewReadiness),
                if (data.nextAction != null) ...[const SizedBox(height: 12), _NextActionCard(action: data.nextAction!)],
                if (data.weakestSkills.isNotEmpty) ...[const SizedBox(height: 12), _WeakestCard(skills: data.weakestSkills)],
                const SizedBox(height: 12),
                const _HuntFunnel(),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The headline number. A dash and a progress count while there is not
/// enough evidence: telling a new user they are at 12% would be both wrong
/// and demoralising.
class IndependenceCard extends StatelessWidget {
  const IndependenceCard({required this.score, super.key});

  final IndependenceScore score;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return LearnPanel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SectionLabel('Independent coding'),
        if (!score.hasEnoughData) ...[
          Text('—', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: tone.muted)),
          Text('${score.attemptsConsidered} of 5 attempts needed', style: TextStyle(fontSize: 12, color: tone.muted)),
        ] else ...[
          Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
            Text('${(score.score! * 100).round()}%', style: TextStyle(fontSize: 34, fontWeight: FontWeight.w800, color: tone.accent)),
            const SizedBox(width: 8),
            if (score.deltaFromPreviousWindow != null && score.deltaFromPreviousWindow != 0)
              Text(
                '${score.deltaFromPreviousWindow! > 0 ? '+' : ''}${score.deltaFromPreviousWindow!.toStringAsFixed(1)}',
                style: TextStyle(fontSize: 14, color: score.deltaFromPreviousWindow! > 0 ? LearnTone.pass : tone.fail),
              ),
          ]),
          const SizedBox(height: 8),
          ClipRRect(borderRadius: BorderRadius.circular(3), child: LinearProgressIndicator(value: score.score, minHeight: 4)),
          const SizedBox(height: 6),
          Text('Last ${score.windowDays} days · ${score.attemptsConsidered} attempts', style: TextStyle(fontSize: 12, color: tone.muted)),
        ],
      ]),
    );
  }
}

class _TodayCard extends StatelessWidget {
  const _TodayCard({required this.done, required this.target, required this.readiness});

  final int done;
  final int target;
  final double? readiness;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return LearnPanel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SectionLabel('Today'),
        Text('$done / $target min', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: tone.strong)),
        const SizedBox(height: 8),
        ClipRRect(
          borderRadius: BorderRadius.circular(3),
          child: LinearProgressIndicator(value: target == 0 ? 0 : (done / target).clamp(0.0, 1.0), minHeight: 4),
        ),
        if (readiness != null) ...[
          const SizedBox(height: 10),
          Text('Interview readiness ${(readiness! * 100).round()}%', style: TextStyle(fontSize: 13, color: tone.body)),
        ],
      ]),
    );
  }
}

class _NextActionCard extends StatelessWidget {
  const _NextActionCard({required this.action});

  final NextAction action;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return LearnPanel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SectionLabel('Next'),
        Text(action.title, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: tone.strong)),
        const SizedBox(height: 4),
        // The rationale is always shown: an opaque recommendation is not a
        // trusted one.
        Text(action.rationale, style: TextStyle(fontSize: 13, color: tone.body, height: 1.5)),
        const SizedBox(height: 8),
        Text(
          action.requiresDesktop ? 'Open Offerpath on your computer to write this one. ${action.estimatedMinutes} min.' : 'About ${action.estimatedMinutes} min, from Learn.',
          style: TextStyle(fontSize: 12, color: tone.muted),
        ),
      ]),
    );
  }
}

class _WeakestCard extends StatelessWidget {
  const _WeakestCard({required this.skills});

  final List<WeakSkill> skills;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return LearnPanel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SectionLabel('Weakest right now'),
        for (final skill in skills)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(skill.conceptName, style: TextStyle(color: tone.strong, fontSize: 14)),
                  Text(skill.technologyName, style: TextStyle(color: tone.muted, fontSize: 12)),
                ]),
              ),
              Text('${(skill.value * 100).round()}%', style: TextStyle(color: tone.fail, fontSize: 14)),
            ]),
          ),
      ]),
    );
  }
}

/// Found → applied → interviews → offers, from the applications the phone
/// already has.
class _HuntFunnel extends StatelessWidget {
  const _HuntFunnel();

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final items = context.watch<ApplicationsController>().items;
    final c = HomeCounts.from(items);
    final steps = [('Applications', items.length), ('Applied', c.applied + c.interviews + c.offers), ('Interviews', c.interviews + c.offers), ('Offers', c.offers)];
    return LearnPanel(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const SectionLabel('Hunt'),
        Row(children: [
          for (final (label, count) in steps)
            Expanded(
              child: Column(children: [
                Text('$count', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: tone.strong)),
                Text(label, style: TextStyle(fontSize: 11, color: tone.muted)),
              ]),
            ),
        ]),
      ]),
    );
  }
}
