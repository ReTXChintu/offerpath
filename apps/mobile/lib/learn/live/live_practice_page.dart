import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../models/live_practice.dart';
import '../../services/api_client.dart';
import '../../state/live_practice_controller.dart';
import '../../widgets/common.dart';
import '../prep_widgets.dart';
import '../simple_markdown.dart';
import '../ui.dart';
import 'segment_recorder.dart';

/// Keeps the screen on (or lets it sleep). Failures are ignored: a screen
/// that dims is no reason to stop practising.
typedef LiveWakelock = Future<void> Function(bool on);

Future<void> platformLiveWakelock(bool on) async {
  try {
    await WakelockPlus.toggle(enable: on);
  } catch (_) {}
}

/// Where the "Show AI answers" choice is kept on this phone.
const liveRevealAfterKey = 'offerpath.live_practice.reveal_after_answer';

Future<bool> loadLiveRevealAfter() async {
  try {
    return (await SharedPreferences.getInstance()).getBool(
          liveRevealAfterKey,
        ) ??
        false;
  } catch (_) {
    return false;
  }
}

Future<void> saveLiveRevealAfter(bool after) async {
  try {
    await (await SharedPreferences.getInstance()).setBool(
      liveRevealAfterKey,
      after,
    );
  } catch (_) {}
}

/// Whether the AI answer to [q] shows by itself in "After the answer" mode:
/// once someone answered and the answer is graded or the next question has
/// been asked (or the session is over).
bool liveAnswerUnlocked(LivePracticeView view, LiveQuestion q) =>
    view.isEnded ||
    (q.hasSpokenAnswer && (q.isGraded || view.hasNewerQuestion(q)));

/// One live-practice session: the phone on the table between two people
/// taking turns asking each other questions. The mic button starts and
/// pauses listening; question cards (newest first) show the AI answer, the
/// spoken answer and its grade. The screen stays on while listening.
class LivePracticePage extends StatefulWidget {
  const LivePracticePage({
    required this.api,
    required this.sessionId,
    this.initial,
    this.autoStart = false,
    this.recorder,
    this.wakelock = platformLiveWakelock,
    this.pollEvery = const Duration(seconds: 3),
    super.key,
  });

  final ApiClient api;
  final String sessionId;
  final LivePracticeView? initial;

  /// Start listening at once (a session that was just created).
  final bool autoStart;

  /// The recorder (a fake in tests); the microphone by default.
  final SegmentRecorder? recorder;
  final LiveWakelock wakelock;
  final Duration pollEvery;

  @override
  State<LivePracticePage> createState() => _LivePracticePageState();
}

class _LivePracticePageState extends State<LivePracticePage>
    with WidgetsBindingObserver {
  late final LivePracticeController _c = LivePracticeController(
    api: widget.api,
    sessionId: widget.sessionId,
    initial: widget.initial,
    recorder: widget.recorder,
    pollEvery: widget.pollEvery,
  );
  final _text = TextEditingController();
  final Set<String> _revealed = {};
  bool _revealAfter = false;
  bool _awake = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _c.addListener(_onChange);
    if (widget.initial == null) _c.load();
    loadLiveRevealAfter().then((after) {
      if (mounted && after != _revealAfter) {
        setState(() => _revealAfter = after);
      }
    });
    if (widget.autoStart) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && widget.initial?.isActive == true) _c.startListening();
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _c.removeListener(_onChange);
    if (_awake) widget.wakelock(false);
    _c.dispose();
    _text.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Never record in the background.
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden ||
        state == AppLifecycleState.detached) {
      _c.pauseListening();
    }
  }

  void _onChange() {
    if (_c.listening != _awake) {
      _awake = _c.listening;
      widget.wakelock(_awake);
    }
    final error = _c.takeActionError();
    if (error != null && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
    }
    if (mounted) setState(() {});
  }

  Future<void> _setRevealAfter(bool after) async {
    setState(() => _revealAfter = after);
    await saveLiveRevealAfter(after);
  }

  Future<void> _send() async {
    final text = _text.text;
    if (text.trim().isEmpty) return;
    if (await _c.sendText(text) && mounted) _text.clear();
  }

  Future<void> _end() async {
    final ok = await confirmDialog(
      context,
      title: 'End this session?',
      message: 'The microphone stops, and answers that are not graded yet are graded now.',
      confirm: 'End session',
    );
    if (ok) await _c.end();
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(
      context,
      title: 'Delete this session?',
      message: 'The transcript, the questions and their grades go with it.',
      confirm: 'Delete',
    );
    if (!ok || !mounted) return;
    if (await _c.delete() && mounted) Navigator.of(context).pop();
  }

  void _openTranscript() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.75,
        maxChildSize: 0.95,
        builder: (context, scroll) => ListenableBuilder(
          listenable: _c,
          builder: (context, _) => LiveTranscript(
            lines: _c.view?.lines ?? const [],
            controller: scroll,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final view = _c.view;
    return Scaffold(
      appBar: AppBar(
        title: Text(view?.title ?? 'Live practice'),
        actions: [
          if (view != null) ...[
            IconButton(
              onPressed: _openTranscript,
              icon: const Icon(Icons.subject),
              tooltip: 'Transcript',
            ),
            PopupMenuButton<String>(
              onSelected: (v) => v == 'end' ? _end() : _delete(),
              itemBuilder: (_) => [
                if (view.isActive)
                  const PopupMenuItem(value: 'end', child: Text('End session')),
                const PopupMenuItem(value: 'delete', child: Text('Delete')),
              ],
            ),
          ],
        ],
      ),
      body: view == null
          ? (_c.loadError == null
                ? const Center(child: CircularProgressIndicator())
                : LearnMessage(
                    icon: Icons.error_outline,
                    title: 'Could not load this session',
                    body: liveErrorMessage(_c.loadError),
                    action: 'Try again',
                    onAction: _c.load,
                  ))
          : _body(context, view),
    );
  }

  Widget _body(BuildContext context, LivePracticeView view) {
    final tone = LearnTone.of(context);
    final questions = view.questions.reversed.toList();
    return Column(
      children: [
        if (_c.uploadError != null)
          InlineNotice(
            icon: Icons.warning_amber_rounded,
            text: _c.uploadError!,
            color: LearnTone.warn,
            trailing: InkWell(
              onTap: _c.clearUploadError,
              child: const Padding(
                padding: EdgeInsets.only(left: 6),
                child: Icon(Icons.close, size: 16, semanticLabel: 'Dismiss'),
              ),
            ),
          ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _c.load,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                view.isActive
                    ? _MicPanel(controller: _c, onEnd: _end)
                    : _SummaryPanel(view: view),
                const SizedBox(height: 14),
                _Settings(
                  answerFor: view.answerFor,
                  changingAnswerFor: _c.changingAnswerFor,
                  canChangeAnswerFor: view.isActive,
                  onAnswerFor: _c.setAnswerFor,
                  revealAfter: _revealAfter,
                  onRevealAfter: _setRevealAfter,
                ),
                const SizedBox(height: 20),
                SectionLabel('Questions · ${view.questions.length}'),
                if (questions.isEmpty)
                  Text(
                    view.isActive
                        ? 'No questions yet. Take turns asking each other; each question shows up here with an AI answer to compare with.'
                        : 'No questions were asked in this session.',
                    style: TextStyle(
                      fontSize: 13,
                      color: tone.muted,
                      height: 1.5,
                    ),
                  ),
                for (final q in questions)
                  LiveQuestionCard(
                    key: ValueKey(q.id),
                    question: q,
                    grading: _c.isGrading(q),
                    showAnswer:
                        !_revealAfter ||
                        _revealed.contains(q.id) ||
                        liveAnswerUnlocked(view, q),
                    onReveal: () => setState(() => _revealed.add(q.id)),
                    onGrade: () => _c.grade(q.id),
                  ),
              ],
            ),
          ),
        ),
        if (view.isActive) _composer(context),
      ],
    );
  }

  Widget _composer(BuildContext context) {
    final tone = LearnTone.of(context);
    return SafeArea(
      top: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
        decoration: BoxDecoration(
          color: tone.card,
          border: Border(top: BorderSide(color: tone.line)),
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                controller: _text,
                minLines: 1,
                maxLines: 4,
                maxLength: 4000,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _send(),
                decoration: const InputDecoration(
                  hintText: 'Type a question or an answer',
                  counterText: '',
                  isDense: true,
                  border: InputBorder.none,
                ),
              ),
            ),
            IconButton(
              onPressed: _send,
              tooltip: 'Send',
              icon: _c.sendingText > 0
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send),
            ),
          ],
        ),
      ),
    );
  }
}

/// The big mic button, the level meter and the upload count.
class _MicPanel extends StatelessWidget {
  const _MicPanel({required this.controller, required this.onEnd});

  final LivePracticeController controller;
  final VoidCallback onEnd;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final c = controller;
    final on = c.listening;
    final state = c.startingMic
        ? 'Starting the microphone…'
        : on
        ? 'Listening'
        : 'Paused';
    return LearnPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Semantics(
                button: true,
                label: on ? 'Pause listening' : 'Start listening',
                child: Material(
                  color: on ? tone.accent : tone.raised,
                  shape: CircleBorder(
                    side: BorderSide(
                      color: on ? tone.accent : tone.line,
                      width: 2,
                    ),
                  ),
                  clipBehavior: Clip.antiAlias,
                  child: InkWell(
                    key: const ValueKey('live-mic'),
                    onTap: c.startingMic || c.ending ? null : c.toggleListening,
                    child: SizedBox(
                      width: 76,
                      height: 76,
                      child: Icon(
                        on ? Icons.mic : Icons.mic_off_outlined,
                        size: 36,
                        color: on
                            ? Theme.of(context).colorScheme.onPrimary
                            : tone.strong,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      state,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: on ? tone.accent : tone.strong,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ValueListenableBuilder<double>(
                      valueListenable: c.recorder.level,
                      builder: (context, level, _) => ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: LinearProgressIndicator(
                          value: on ? level : 0,
                          minHeight: 8,
                          backgroundColor: tone.line,
                          semanticsLabel: 'Input level',
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (c.uploading > 0)
                      Row(
                        children: [
                          const SizedBox(
                            width: 12,
                            height: 12,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          const SizedBox(width: 8),
                          Text(
                            c.uploading == 1
                                ? 'Uploading…'
                                : 'Uploading · ${c.uploading} waiting',
                            style: TextStyle(fontSize: 12, color: tone.muted),
                          ),
                        ],
                      )
                    else
                      Text(
                        on
                            ? 'Speak naturally; a pause ends each part.'
                            : 'Tap the mic to listen.',
                        style: TextStyle(fontSize: 12, color: tone.muted),
                      ),
                  ],
                ),
              ),
            ],
          ),
          if (c.micError != null) ...[
            const SizedBox(height: 10),
            Text(
              c.micError!,
              style: TextStyle(fontSize: 13, color: tone.fail, height: 1.4),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            'Put the phone between you and take turns asking each other questions. For practice with a partner only.',
            style: TextStyle(fontSize: 12, color: tone.muted, height: 1.4),
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: c.ending ? null : onEnd,
              icon: c.ending
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.stop_circle_outlined),
              label: const Text('End session'),
            ),
          ),
        ],
      ),
    );
  }
}

/// An ended session: how it went, and whether grades are still coming.
class _SummaryPanel extends StatelessWidget {
  const _SummaryPanel({required this.view});

  final LivePracticeView view;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final avg = view.stats.averageScore;
    Widget stat(String value, String label, {Color? color}) => Expanded(
      child: Column(
        children: [
          Text(
            value,
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: color ?? tone.strong,
            ),
          ),
          Text(label, style: TextStyle(fontSize: 11, color: tone.muted)),
        ],
      ),
    );
    return LearnPanel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Session ended',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: tone.strong,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              stat('${view.stats.questions}', 'questions'),
              stat('${view.stats.graded}', 'graded'),
              stat(
                avg == null ? '—' : formatPrepScore(avg),
                'average',
                color: avg == null ? tone.muted : prepScoreColor(context, avg),
              ),
            ],
          ),
          if (view.anyGrading) ...[
            const SizedBox(height: 12),
            Text(
              'Grading the answers…',
              style: TextStyle(fontSize: 12, color: tone.muted),
            ),
            const SizedBox(height: 6),
            const LinearProgressIndicator(),
          ],
        ],
      ),
    );
  }
}

/// "Answers for: Me / Neutral" and "Show AI answers: Right away / After
/// the answer".
class _Settings extends StatelessWidget {
  const _Settings({
    required this.answerFor,
    required this.changingAnswerFor,
    required this.canChangeAnswerFor,
    required this.onAnswerFor,
    required this.revealAfter,
    required this.onRevealAfter,
  });

  final AnswerFor answerFor;
  final bool changingAnswerFor;
  final bool canChangeAnswerFor;
  final ValueChanged<AnswerFor> onAnswerFor;
  final bool revealAfter;
  final ValueChanged<bool> onRevealAfter;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    Widget label(String text) => Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w700,
          color: tone.muted,
        ),
      ),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        label('Answers for'),
        SegmentedButton<AnswerFor>(
          segments: const [
            ButtonSegment(
              value: AnswerFor.me,
              label: Text('Me'),
              icon: Icon(Icons.person_outline),
            ),
            ButtonSegment(
              value: AnswerFor.neutral,
              label: Text('Neutral'),
              icon: Icon(Icons.public),
            ),
          ],
          selected: {answerFor},
          showSelectedIcon: false,
          onSelectionChanged: !canChangeAnswerFor || changingAnswerFor
              ? null
              : (s) => onAnswerFor(s.first),
        ),
        const SizedBox(height: 4),
        Text(
          answerFor == AnswerFor.me
              ? 'AI answers use your CV or profile. Changes apply to the next question.'
              : 'AI answers are for any candidate, without your CV. Changes apply to the next question.',
          style: TextStyle(fontSize: 11.5, color: tone.muted, height: 1.4),
        ),
        const SizedBox(height: 12),
        label('Show AI answers'),
        SegmentedButton<bool>(
          segments: const [
            ButtonSegment(value: false, label: Text('Right away')),
            ButtonSegment(value: true, label: Text('After the answer')),
          ],
          selected: {revealAfter},
          showSelectedIcon: false,
          onSelectionChanged: (s) => onRevealAfter(s.first),
        ),
      ],
    );
  }
}

/// One question: the AI answer (or "Reveal"), the spoken answer, and its
/// grade.
class LiveQuestionCard extends StatefulWidget {
  const LiveQuestionCard({
    required this.question,
    required this.grading,
    required this.showAnswer,
    required this.onReveal,
    required this.onGrade,
    super.key,
  });

  final LiveQuestion question;
  final bool grading;
  final bool showAnswer;
  final VoidCallback onReveal;
  final VoidCallback onGrade;

  @override
  State<LiveQuestionCard> createState() => _LiveQuestionCardState();
}

class _LiveQuestionCardState extends State<LiveQuestionCard> {
  bool _more = false;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final q = widget.question;
    final score = q.score;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: tone.card,
        border: Border.all(color: tone.line),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Tag('Q${q.order + 1}', color: tone.accent),
              const SizedBox(width: 6),
              Tag(
                q.answerFor == AnswerFor.me ? 'For you' : 'Neutral',
                color: tone.muted,
              ),
              const Spacer(),
              if (score != null)
                Text(
                  formatPrepScore(score),
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: prepScoreColor(context, score),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            q.text,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: tone.strong,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 12),
          _aiAnswer(context),
          const SizedBox(height: 12),
          _label(context, 'Spoken answer'),
          Text(
            q.hasSpokenAnswer ? q.spokenAnswer! : 'Waiting for the answer…',
            style: TextStyle(
              fontSize: 14,
              color: q.hasSpokenAnswer ? tone.body : tone.muted,
              fontStyle: q.hasSpokenAnswer ? null : FontStyle.italic,
              height: 1.5,
            ),
          ),
          _grade(context),
        ],
      ),
    );
  }

  Widget _label(BuildContext context, String text) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 10.5,
        letterSpacing: 0.7,
        fontWeight: FontWeight.w700,
        color: LearnTone.of(context).muted,
      ),
    ),
  );

  Widget _aiAnswer(BuildContext context) {
    final tone = LearnTone.of(context);
    final ai = widget.question.aiAnswer;
    if (!widget.showAnswer) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(12, 8, 6, 8),
        decoration: BoxDecoration(
          color: tone.raised,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          children: [
            Icon(Icons.visibility_off_outlined, size: 18, color: tone.muted),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'AI answer hidden until the question is answered',
                style: TextStyle(fontSize: 12.5, color: tone.muted),
              ),
            ),
            TextButton(onPressed: widget.onReveal, child: const Text('Reveal')),
          ],
        ),
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tone.accent.withValues(alpha: 0.06),
        border: Border.all(color: tone.accent.withValues(alpha: 0.25)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _label(context, 'AI answer'),
          if (ai.isEmpty)
            Text(
              'No AI answer for this one.',
              style: TextStyle(fontSize: 13, color: tone.muted),
            ),
          if (ai.summary.isNotEmpty)
            Text(
              ai.summary,
              style: TextStyle(fontSize: 14, color: tone.strong, height: 1.5),
            ),
          for (final p in ai.points)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 16,
                    child: Text('•', style: TextStyle(color: tone.muted)),
                  ),
                  Expanded(
                    child: Text(
                      p,
                      style: TextStyle(
                        fontSize: 13.5,
                        color: tone.body,
                        height: 1.45,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (ai.detail.trim().isNotEmpty) ...[
            if (_more) ...[
              const SizedBox(height: 10),
              SimpleMarkdown(ai.detail, fontSize: 13.5),
            ],
            TextButton(
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                visualDensity: VisualDensity.compact,
              ),
              onPressed: () => setState(() => _more = !_more),
              child: Text(_more ? 'Less' : 'More'),
            ),
          ],
        ],
      ),
    );
  }

  Widget _grade(BuildContext context) {
    final tone = LearnTone.of(context);
    final q = widget.question;
    if (widget.grading) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Row(
          children: [
            const SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
            const SizedBox(width: 8),
            Text('Grading…', style: TextStyle(fontSize: 13, color: tone.muted)),
          ],
        ),
      );
    }
    final feedback = q.feedback;
    if (q.isGraded) {
      return Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _label(context, 'Grade · ${formatPrepScore(q.score!)}'),
            if (feedback != null) ...[
              for (final c in feedback.covered)
                _point(context, Icons.check_circle_outline, LearnTone.pass, c),
              for (final m in feedback.missed)
                _point(context, Icons.highlight_off, tone.fail, m),
              if (feedback.feedback.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  feedback.feedback,
                  style: TextStyle(
                    fontSize: 13.5,
                    color: tone.body,
                    height: 1.5,
                  ),
                ),
              ],
            ],
          ],
        ),
      );
    }
    if (q.hasSpokenAnswer) {
      return Padding(
        padding: const EdgeInsets.only(top: 10),
        child: OutlinedButton.icon(
          onPressed: widget.onGrade,
          icon: const Icon(Icons.grading, size: 18),
          label: const Text('Grade now'),
        ),
      );
    }
    return const SizedBox.shrink();
  }

  Widget _point(
    BuildContext context,
    IconData icon,
    Color color,
    String text,
  ) => Padding(
    padding: const EdgeInsets.only(top: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 16, color: color),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: TextStyle(
              fontSize: 13,
              color: LearnTone.of(context).body,
              height: 1.4,
            ),
          ),
        ),
      ],
    ),
  );
}

/// Every line said in the session, styled by kind.
class LiveTranscript extends StatelessWidget {
  const LiveTranscript({required this.lines, this.controller, super.key});

  final List<LiveLine> lines;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    if (lines.isEmpty) {
      return ListView(
        controller: controller,
        padding: const EdgeInsets.all(24),
        children: [
          Text(
            'Nothing has been said yet.',
            textAlign: TextAlign.center,
            style: TextStyle(color: tone.muted),
          ),
        ],
      );
    }
    return ListView.builder(
      controller: controller,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      itemCount: lines.length + 1,
      itemBuilder: (context, i) {
        if (i == 0) return const SectionLabel('Transcript');
        final line = lines[i - 1];
        final (color, label) = switch (line.kind) {
          LineKind.question => (tone.accent, 'Question'),
          LineKind.answer => (LearnTone.pass, 'Answer'),
          LineKind.other => (tone.muted, 'Other'),
        };
        return Container(
          margin: const EdgeInsets.only(bottom: 10),
          padding: const EdgeInsets.only(left: 10),
          decoration: BoxDecoration(
            border: Border(left: BorderSide(color: color, width: 3)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label.toUpperCase(),
                style: TextStyle(
                  fontSize: 10,
                  letterSpacing: 0.6,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                line.text,
                style: TextStyle(
                  fontSize: 14,
                  height: 1.45,
                  color: line.kind == LineKind.other ? tone.muted : tone.strong,
                  fontWeight: line.kind == LineKind.question
                      ? FontWeight.w700
                      : FontWeight.normal,
                  fontStyle: line.kind == LineKind.other
                      ? FontStyle.italic
                      : null,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
