import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/interview_prep.dart';
import '../models/live_practice.dart';
import '../models/mock_interview.dart';
import '../services/api_client.dart';
import '../state/auth_controller.dart';
import '../state/interview_prep_controller.dart';
import '../util/format.dart';
import '../widgets/common.dart';
import 'live/live_practice_list_page.dart';
import 'mock_interview_page.dart';
import 'prep_create_page.dart';
import 'prep_cv_field.dart';
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
  const PrepDetailPage({required this.api, required this.prepId, this.preps, this.voice, this.pollEvery = const Duration(seconds: 5), this.cvPicker = pickCvFile, super.key});

  final ApiClient api;
  final String prepId;

  /// The shared list: kept up to date from here, and its `changes` stream
  /// refreshes this screen.
  final InterviewPrepController? preps;
  final VoiceInput? voice;
  final Duration pollEvery;

  /// The CV file picker the edit form uses (a fake in tests).
  final CvFilePicker cvPicker;

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

  /// The whole form: company, role, time, and (rewriting the plan) the job
  /// description, technologies, DSA and the CV.
  Future<void> _edit() async {
    final prep = _prep;
    if (prep == null) return;
    final saved = await openPrepEdit(context, widget.api, prep, preps: widget.preps, cvPicker: widget.cvPicker);
    if (saved == null || !mounted) return;
    _show(saved);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(saved.isGenerating ? 'Saved. Writing the new plan and questions…' : 'Saved.')));
  }

  /// Starts (or continues) the prep's mock interview.
  Future<void> _startMock() async {
    final prep = _prep;
    if (prep == null || _busy) return;
    setState(() => _busy = true);
    MockInterview? interview;
    try {
      interview = await widget.api.startMockInterview(prep.id);
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(prepErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (interview == null || !mounted) return;
    await _openMock(interview.id, initial: interview);
  }

  /// Live practice with a partner, its AI answers written for this prep.
  /// It needs the user's OpenAI key: without one, says where to add it.
  Future<void> _startLive() async {
    if (_busy) return;
    setState(() => _busy = true);
    LiveReady? ready;
    LivePracticeView? view;
    try {
      ready = await widget.api.livePracticeReady();
      if (ready.ready) view = await widget.api.startLivePractice(prepId: widget.prepId);
    } catch (error) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(liveErrorMessage(error))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    if (ready != null && !ready.ready) {
      await showLiveNotReady(context, ready.reason);
    } else if (view != null) {
      await openLivePractice(context, widget.api, view.id, initial: view, autoStart: true);
    }
  }

  Future<void> _openMock(String id, {MockInterview? initial}) async {
    await Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => MockInterviewPage(api: widget.api, interviewId: id, initial: initial, title: _prep?.title, preps: widget.preps, voice: widget.voice),
    ));
    // Its status and score changed while it was open.
    if (mounted) await _load();
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(context, title: 'Delete this prep?', message: 'The plan, the questions, your practice answers and mock interviews go with it.', confirm: 'Delete');
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
            IconButton(onPressed: _busy ? null : _edit, icon: const Icon(Icons.edit_outlined), tooltip: 'Edit'),
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
                  if (prep.isReady) _mockCard(context, prep),
                  if (prep.isReady) _liveButton(context),
                  if (prep.mockInterviews.isNotEmpty) ...[
                    const SizedBox(height: 22),
                    SectionLabel('Mock interviews · ${prep.mockInterviews.length}'),
                    for (final m in prep.mockInterviews) _MockInterviewTile(summary: m, onTap: () => _openMock(m.id)),
                  ],
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

  /// "Start mock interview" (or "Continue" when one is in progress).
  Widget _mockCard(BuildContext context, Prep prep) {
    final tone = LearnTone.of(context);
    final active = prep.activeMockInterview;
    final coding = prep.includeDsa ? 'DSA problems' : 'a coding task';
    return Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: tone.accent.withValues(alpha: 0.07),
        border: Border.all(color: tone.accent.withValues(alpha: 0.35)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          IconBubble(Icons.record_voice_over_outlined, color: tone.accent, size: 36),
          const SizedBox(width: 12),
          Expanded(child: Text('Mock interview', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: tone.strong))),
        ]),
        const SizedBox(height: 8),
        Text(
          active != null
              ? 'You have an interview in progress (${active.answered} answered, now in ${mockStageLabel(active.stage).toLowerCase()}). Pick up where you left off.'
              : 'A live interview with an AI interviewer: introduce yourself, technical questions, $coding, and a wrap-up. '
                  'Answer typed or spoken; your grammar is checked as you go, and you get a full report at the end.',
          style: TextStyle(fontSize: 13, color: tone.body, height: 1.5),
        ),
        if (prep.resume == null) ...[
          const SizedBox(height: 6),
          Text('Tip: add your CV (Edit) so the interviewer can ask about your own experience.', style: TextStyle(fontSize: 12, color: tone.muted, height: 1.4)),
        ],
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _busy ? null : _startMock,
          style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
          icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(active != null ? Icons.play_circle_outline : Icons.play_arrow),
          label: Text(active != null ? 'Continue mock interview' : 'Start mock interview'),
        ),
      ]),
    );
  }

  /// "Practise live with a partner": the phone listens while two people ask
  /// each other this prep's kind of questions.
  Widget _liveButton(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 10),
        child: OutlinedButton.icon(
          onPressed: _busy ? null : _startLive,
          style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 12)),
          icon: const Icon(Icons.people_alt_outlined),
          label: const Text('Practise live with a partner'),
        ),
      );

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
      const SizedBox(height: 8),
      Wrap(spacing: 6, runSpacing: 6, children: [
        if (prep.includeDsa) Tag('DSA questions', color: tone.accent, icon: Icons.account_tree_outlined),
        prep.resume == null
            ? Tag('No CV', color: tone.muted, icon: Icons.description_outlined)
            : Tag('CV: ${prep.resume!.fileName ?? prepResumeSourceLabel(prep.resume!.source)}', color: tone.accent, icon: Icons.description_outlined),
      ]),
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

/// One past (or running) mock interview in the prep's list.
class _MockInterviewTile extends StatelessWidget {
  const _MockInterviewTile({required this.summary, required this.onTap});

  final MockInterviewSummary summary;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final score = summary.overallScore;
    final statusColor = switch (summary.status) {
      MockStatus.completed => LearnTone.pass,
      MockStatus.inProgress || MockStatus.reporting => tone.accent,
      MockStatus.failed => tone.fail,
      MockStatus.abandoned => tone.muted,
    };
    final detail = [
      '${summary.answered} answered',
      if (summary.verdict != null) mockVerdictLabel(summary.verdict!),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: tone.card,
        shape: RoundedRectangleBorder(side: BorderSide(color: tone.line), borderRadius: BorderRadius.circular(12)),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Flexible(child: Text(formatDateTime(context, summary.startedAt), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: tone.strong))),
                    const SizedBox(width: 8),
                    Tag(mockStatusLabel(summary.status), color: statusColor),
                  ]),
                  const SizedBox(height: 3),
                  Text(detail, style: TextStyle(fontSize: 12, color: tone.muted)),
                ]),
              ),
              if (score != null) Text(formatPrepScore(score), style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: prepScoreColor(context, score))),
              Icon(Icons.chevron_right, size: 20, color: tone.muted),
            ]),
          ),
        ),
      ),
    );
  }
}
