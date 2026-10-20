import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/interview_prep.dart';
import '../models/mock_interview.dart';
import '../services/api_client.dart';
import '../state/auth_controller.dart';
import '../state/interview_prep_controller.dart';
import '../state/mock_interview_controller.dart';
import '../widgets/common.dart';
import 'prep_widgets.dart';
import 'simple_markdown.dart';
import 'ui.dart';
import 'voice.dart';

/// Opens a mock interview (from a prep, or the report-ready notification).
Future<void> openMockInterview(
  BuildContext context,
  String interviewId, {
  MockInterview? initial,
  String? title,
}) async {
  final api = context.read<AuthController>().api;
  if (api == null) return;
  final preps = Provider.of<InterviewPrepController?>(context, listen: false);
  await Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => MockInterviewPage(
        api: api,
        interviewId: interviewId,
        initial: initial,
        title: title,
        preps: preps,
      ),
    ),
  );
}

/// The languages offered for a coding answer: the value sent, and its label.
const mockCodeLanguages = <(String, String)>[
  ('python', 'Python'),
  ('javascript', 'JavaScript'),
  ('typescript', 'TypeScript'),
  ('java', 'Java'),
  ('kotlin', 'Kotlin'),
  ('cpp', 'C++'),
  ('csharp', 'C#'),
  ('go', 'Go'),
  ('rust', 'Rust'),
  ('swift', 'Swift'),
  ('dart', 'Dart'),
  ('ruby', 'Ruby'),
  ('php', 'PHP'),
  ('sql', 'SQL'),
];

/// The coding language to start with, from the prep's technologies: a
/// language named outright wins over one implied by a framework.
String guessCodeLanguage(Iterable<String> technologies) {
  final techs = technologies.map((t) => t.toLowerCase().trim()).toList();
  String? named(String t) => switch (t) {
    'typescript' || 'ts' => 'typescript',
    'javascript' || 'js' => 'javascript',
    'python' => 'python',
    'kotlin' => 'kotlin',
    'java' => 'java',
    'c++' || 'cpp' => 'cpp',
    'c#' || 'csharp' => 'csharp',
    'go' || 'golang' => 'go',
    'rust' => 'rust',
    'swift' => 'swift',
    'dart' => 'dart',
    'ruby' => 'ruby',
    'php' => 'php',
    _ => null,
  };
  String? implied(String t) {
    if (t.contains('angular') ||
        t.contains('nestjs') ||
        t.contains('typescript')) {
      return 'typescript';
    }
    if (t.contains('react') ||
        t.contains('node') ||
        t.contains('vue') ||
        t.contains('next') ||
        t.contains('express')) {
      return 'javascript';
    }
    if (t.contains('django') ||
        t.contains('flask') ||
        t.contains('fastapi') ||
        t.contains('pandas')) {
      return 'python';
    }
    if (t.contains('spring')) return 'java';
    if (t.contains('.net') || t.contains('asp')) return 'csharp';
    if (t.contains('flutter')) return 'dart';
    if (t.contains('rails')) return 'ruby';
    if (t.contains('laravel')) return 'php';
    if (t.contains('android')) return 'kotlin';
    if (t.contains('ios')) return 'swift';
    return null;
  }

  return techs.map(named).nonNulls.firstOrNull ??
      techs.map(implied).nonNulls.firstOrNull ??
      'python';
}

/// A mock interview, as close to the real thing as a phone gets: the
/// interviewer asks, the candidate answers typed or spoken (and in code for
/// the coding round), and the conversation moves through intro, technical,
/// coding and wrap-up. Under each answer, the language feedback. At the end
/// (or on "End interview") the report is written in the background; this
/// page then shows it, question by question.
class MockInterviewPage extends StatefulWidget {
  const MockInterviewPage({
    required this.api,
    required this.interviewId,
    this.initial,
    this.title,
    this.preps,
    this.voice,
    this.pollEvery = const Duration(seconds: 4),
    super.key,
  });

  final ApiClient api;
  final String interviewId;

  /// The view the start call returned, so the first question shows at once.
  final MockInterview? initial;

  /// "Backend developer at Acme"; looked up from the prep when not given.
  final String? title;
  final InterviewPrepController? preps;

  /// Injected so the screen is testable without a microphone.
  final VoiceInput? voice;
  final Duration pollEvery;

  @override
  State<MockInterviewPage> createState() => _MockInterviewPageState();
}

class _MockInterviewPageState extends State<MockInterviewPage> {
  late final MockInterviewController _session = MockInterviewController(
    api: widget.api,
    interviewId: widget.interviewId,
    initial: widget.initial,
    changes: widget.preps?.changes,
    pollEvery: widget.pollEvery,
  );
  late final VoiceInput _voice = widget.voice ?? PlatformVoiceInput();
  final _answer = TextEditingController();
  final _code = TextEditingController();
  final _scroll = ScrollController();

  String? _title;
  String _language = 'python';
  bool _languagePicked = false;
  bool _prepLookedUp = false;
  bool _voiceReady = false;
  bool _listening = false;
  String _textBeforeDictation = '';
  int _seen = -1;

  @override
  void initState() {
    super.initState();
    _title = widget.title;
    _session.addListener(_changed);
    // With an initial view this is a fresh copy (and starts the poll when the
    // server is busy).
    _session.load();
    if (widget.initial != null) _lookUpPrep(widget.initial!.prepId);
    _voice
        .prepare()
        .then((ready) {
          if (mounted) setState(() => _voiceReady = ready);
        })
        .catchError((_) {});
  }

  @override
  void dispose() {
    _session.removeListener(_changed);
    _session.dispose();
    _voice.stop();
    _answer.dispose();
    _code.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _changed() {
    if (!mounted) return;
    final interview = _session.interview;
    if (interview != null) _lookUpPrep(interview.prepId);
    setState(() {});
    // Scroll to the newest turn when one arrives (or an answer goes out).
    final count =
        (interview?.turns.length ?? 0) * 4 +
        (_session.sending ? 1 : 0) +
        (_session.thinking ? 2 : 0);
    if (count != _seen) {
      _seen = count;
      if (interview != null && !interview.isCompleted) _scrollToEnd();
    }
  }

  /// The prep's title for the app bar, and its technologies to pick the
  /// coding language.
  void _lookUpPrep(String prepId) {
    if (_prepLookedUp || prepId.isEmpty) return;
    _prepLookedUp = true;
    final known = widget.preps?.items.where((p) => p.id == prepId).firstOrNull;
    if (known != null) {
      _usePrep(known);
      return;
    }
    widget.api
        .getPrep(prepId)
        .then((prep) {
          if (mounted) setState(() => _usePrep(prep));
        })
        .catchError((_) {});
  }

  void _usePrep(Prep prep) {
    _title ??= prep.title;
    if (!_languagePicked) _language = guessCodeLanguage(prep.technologies);
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _send() async {
    final interview = _session.interview;
    if (interview == null || _session.sending) return;
    await _stopDictation();
    final coding = interview.isCodingQuestion;
    final text = _answer.text;
    final code = coding ? _code.text : null;
    // Cleared at once, as in a chat; put back if the answer wasn't saved.
    _answer.clear();
    if (coding) _code.clear();
    final saved = await _session.answer(
      text: text,
      code: code,
      codeLanguage: coding ? _language : null,
    );
    if (!saved && mounted) {
      if (_answer.text.isEmpty) _answer.text = text;
      if (coding && _code.text.isEmpty) _code.text = code ?? '';
    }
  }

  Future<void> _end() async {
    final ok = await confirmDialog(
      context,
      title: 'End the interview?',
      message: "The interviewer stops here and writes your report from what you've answered so far.",
      confirm: 'End interview',
    );
    if (!ok || !mounted) return;
    await _stopDictation();
    await _session.finish();
    _snackError();
  }

  Future<void> _restart() async {
    await _session.restart();
    _snackError();
    _seen = -1;
    _changed();
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(
      context,
      title: 'Delete this mock interview?',
      message: 'The transcript and the report go with it.',
      confirm: 'Delete',
    );
    if (!ok || !mounted) return;
    if (await _session.delete()) {
      if (mounted) Navigator.of(context).pop();
    } else {
      _snackError();
    }
  }

  void _snackError() {
    final error = _session.actionError;
    if (error != null && mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
    }
  }

  Future<void> _toggleDictation() async {
    if (_listening) {
      await _stopDictation();
      return;
    }
    _textBeforeDictation = _answer.text;
    setState(() => _listening = true);
    await _voice.start((transcript) {
      if (!mounted) return;
      final prefix = _textBeforeDictation.trim().isEmpty
          ? ''
          : '${_textBeforeDictation.trim()} ';
      _answer.value = TextEditingValue(
        text: '$prefix$transcript',
        selection: TextSelection.collapsed(
          offset: prefix.length + transcript.length,
        ),
      );
    });
  }

  Future<void> _stopDictation() async {
    if (!_listening) return;
    await _voice.stop();
    if (mounted) setState(() => _listening = false);
  }

  @override
  Widget build(BuildContext context) {
    final interview = _session.interview;
    final tone = LearnTone.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              _title ?? 'Mock interview',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
            ),
            if (_title != null)
              Text(
                'Mock interview',
                style: TextStyle(fontSize: 12, color: tone.muted),
              ),
          ],
        ),
        actions: [
          if (interview != null && interview.isInProgress)
            TextButton(
              onPressed: _session.busy || _session.sending ? null : _end,
              style: TextButton.styleFrom(foregroundColor: tone.fail),
              child: const Text('End interview'),
            ),
          if (interview != null)
            PopupMenuButton<String>(
              tooltip: 'More',
              onSelected: (v) {
                if (v == 'delete') _delete();
              },
              itemBuilder: (_) => const [
                PopupMenuItem(value: 'delete', child: Text('Delete interview')),
              ],
            ),
        ],
      ),
      body: interview == null
          ? (_session.loadError == null
                ? const Center(child: CircularProgressIndicator())
                : LearnMessage(
                    icon: Icons.error_outline,
                    title: 'Could not load this interview',
                    body:
                        _session.loadError is ApiException &&
                            (_session.loadError as ApiException).status == 404
                        ? 'It may have been deleted.'
                        : prepErrorMessage(_session.loadError),
                    action: 'Try again',
                    onAction: _session.load,
                  ))
          : interview.isCompleted && interview.report != null
          ? _report(context, interview)
          : _conversation(context, interview),
    );
  }

  Widget _conversation(BuildContext context, MockInterview interview) {
    final tone = LearnTone.of(context);
    final pending = _session.pending;
    final banner = switch (interview.status) {
      MockStatus.reporting || MockStatus.completed => Callout(
        icon: Icons.auto_awesome_outlined,
        color: tone.accent,
        title: 'Writing your report…',
        message: "The interviewer is going over your answers. This takes a minute or two; you'll get a notification when it's ready.",
        child: const LinearProgressIndicator(),
      ),
      MockStatus.failed => Callout(
        icon: Icons.error_outline,
        color: tone.fail,
        title: 'Could not write the report',
        message:
            interview.error ?? 'Something went wrong while writing the report.',
        child: Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            onPressed: _session.busy ? null : _session.retryReport,
            icon: _busyIcon(Icons.refresh),
            label: const Text('Try again'),
          ),
        ),
      ),
      MockStatus.abandoned => Callout(
        icon: Icons.stop_circle_outlined,
        color: tone.muted,
        title: 'This interview was ended',
        message: 'A newer mock interview replaced it, so it has no report.',
        child: Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            onPressed: _session.busy ? null : _restart,
            icon: _busyIcon(Icons.play_arrow),
            label: const Text('Start a new mock interview'),
          ),
        ),
      ),
      MockStatus.inProgress => null,
    };
    return Column(
      children: [
        MockStageBar(
          stages: interview.stages,
          current: interview.stage,
          done: !interview.isInProgress,
        ),
        Expanded(
          child: ListView(
            controller: _scroll,
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
            children: [
              ?banner,
              if (banner != null) const SizedBox(height: 16),
              for (final turn in interview.turns) MockTurnBubble(turn: turn),
              if (pending != null) MockTurnBubble.pending(pending),
              if (_session.thinking) const _Thinking(),
              if (interview.replyFailed && !_session.thinking)
                _replyFailed(context, interview),
            ],
          ),
        ),
        if (interview.isInProgress) _composer(context, interview),
      ],
    );
  }

  Widget _busyIcon(IconData icon) => _session.busy
      ? const SizedBox(
          width: 16,
          height: 16,
          child: CircularProgressIndicator(strokeWidth: 2),
        )
      : Icon(icon);

  Widget _replyFailed(BuildContext context, MockInterview interview) {
    final tone = LearnTone.of(context);
    return Container(
      margin: const EdgeInsets.only(top: 4),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tone.fail.withValues(alpha: 0.07),
        border: Border.all(color: tone.fail.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.error_outline, size: 18, color: tone.fail),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  "The interviewer couldn't reply",
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: tone.strong,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            _session.actionError ??
                interview.error ??
                'Your answer is saved. Try again to get the next question.',
            style: TextStyle(fontSize: 13, color: tone.body, height: 1.45),
          ),
          const SizedBox(height: 10),
          FilledButton.tonalIcon(
            onPressed: _session.busy ? null : _session.reply,
            icon: _busyIcon(Icons.refresh),
            label: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _composer(BuildContext context, MockInterview interview) {
    final tone = LearnTone.of(context);
    final coding = interview.isCodingQuestion;
    final enabled = interview.canAnswer && !_session.sending;
    final error = interview.replyFailed ? null : _session.actionError;
    return Container(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.55,
      ),
      decoration: BoxDecoration(
        color: tone.card,
        border: Border(top: BorderSide(color: tone.line)),
      ),
      child: SingleChildScrollView(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 10,
          bottom: MediaQuery.paddingOf(context).bottom + 10,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (error != null) ...[
              Text(
                error,
                style: TextStyle(color: tone.fail, fontSize: 12.5, height: 1.4),
              ),
              const SizedBox(height: 8),
            ],
            if (coding) ...[
              Row(
                children: [
                  Text(
                    'Your code',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: tone.muted,
                    ),
                  ),
                  const Spacer(),
                  DropdownButton<String>(
                    value: _language,
                    isDense: true,
                    underline: const SizedBox.shrink(),
                    onChanged: enabled
                        ? (v) => setState(() {
                            _language = v ?? _language;
                            _languagePicked = true;
                          })
                        : null,
                    items: [
                      for (final (value, label) in mockCodeLanguages)
                        DropdownMenuItem(
                          value: value,
                          child: Text(
                            label,
                            style: const TextStyle(fontSize: 13),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 6),
              TextField(
                key: const ValueKey('mock-code'),
                controller: _code,
                enabled: enabled,
                minLines: 5,
                maxLines: 12,
                keyboardType: TextInputType.multiline,
                autocorrect: false,
                enableSuggestions: false,
                style: TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 13,
                  color: tone.strong,
                  height: 1.4,
                ),
                decoration: InputDecoration(
                  hintText: 'Write your solution here',
                  filled: true,
                  fillColor: tone.raised,
                  isDense: true,
                ),
              ),
              const SizedBox(height: 8),
            ],
            TextField(
              key: const ValueKey('mock-answer'),
              controller: _answer,
              enabled: enabled,
              minLines: coding ? 1 : 2,
              maxLines: 6,
              keyboardType: TextInputType.multiline,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => _session.clearError(),
              decoration: InputDecoration(
                isDense: true,
                hintText: _listening
                    ? 'Listening: say it as you would in the room.'
                    : coding
                    ? 'Talk through your approach and its complexity.'
                    : 'Answer as you would out loud.',
                hintStyle: TextStyle(
                  color: _listening ? tone.accent : tone.muted,
                  fontSize: 13,
                ),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                if (_voiceReady)
                  IconButton(
                    onPressed: enabled ? _toggleDictation : null,
                    icon: Icon(
                      _listening ? Icons.stop_circle_outlined : Icons.mic_none,
                    ),
                    color: _listening ? tone.accent : tone.muted,
                    tooltip: _listening
                        ? 'Stop dictating'
                        : 'Dictate your answer',
                  ),
                Expanded(
                  child: Text(
                    _voiceReady
                        ? 'Dictation runs on your device. Only the text is sent.'
                        : 'Answer the way you would in the room.',
                    style: TextStyle(fontSize: 11, color: tone.muted),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton.icon(
                  onPressed: enabled ? _send : null,
                  icon: _session.sending
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.send, size: 18),
                  label: const Text('Send'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _report(BuildContext context, MockInterview interview) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
      children: [
        MockReportView(interview: interview),
        const SizedBox(height: 24),
        FilledButton.icon(
          onPressed: _session.busy ? null : _restart,
          icon: _busyIcon(Icons.play_arrow),
          label: const Text('Start a new mock interview'),
        ),
        const SizedBox(height: 16),
        Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(
              'Full transcript',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: LearnTone.of(context).strong,
              ),
            ),
            children: [
              for (final turn in interview.turns)
                MockTurnBubble(turn: turn, showAssessment: true),
            ],
          ),
        ),
      ],
    );
  }
}

/// Intro → Technical → Coding → Wrap-up, with the current stage lit.
class MockStageBar extends StatelessWidget {
  const MockStageBar({
    required this.stages,
    required this.current,
    this.done = false,
    super.key,
  });

  final List<MockStage> stages;
  final MockStage current;

  /// The interview is over: every stage shows as passed.
  final bool done;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final at = stages.indexOf(current);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: Row(
        children: [
          for (var i = 0; i < stages.length; i++) ...[
            if (i > 0) const SizedBox(width: 6),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    height: 4,
                    decoration: BoxDecoration(
                      color: done || i < at
                          ? tone.accent
                          : (i == at ? tone.accent : tone.line),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    mockStageLabel(stages[i]),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: i == at && !done
                          ? FontWeight.w800
                          : FontWeight.w500,
                      color: i == at && !done
                          ? tone.accent
                          : (done || i < at ? tone.body : tone.muted),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Thinking extends StatelessWidget {
  const _Thinking();

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          const _Avatar(),
          const SizedBox(width: 10),
          const SizedBox(
            height: 12,
            width: 12,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          const SizedBox(width: 10),
          Text(
            'Interviewer is thinking…',
            style: TextStyle(
              fontSize: 13,
              color: tone.muted,
              fontStyle: FontStyle.italic,
            ),
          ),
        ],
      ),
    );
  }
}

class _Avatar extends StatelessWidget {
  const _Avatar();

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return CircleAvatar(
      radius: 14,
      backgroundColor: tone.accent.withValues(alpha: 0.12),
      child: Icon(
        Icons.record_voice_over_outlined,
        size: 16,
        color: tone.accent,
      ),
    );
  }
}

String _turnKindLabel(String kind) => switch (kind) {
  'FOLLOW_UP' => 'Follow-up',
  'CROSS_QUESTION' => 'Cross-question',
  'NEW_QUESTION' => 'New question',
  'CODING' => 'Coding question',
  'CLOSING' => 'Closing',
  _ => '',
};

/// One turn in the transcript: the interviewer on the left, the candidate
/// on the right with the language feedback under the answer.
class MockTurnBubble extends StatelessWidget {
  const MockTurnBubble({
    required MockTurn this.turn,
    this.showAssessment = false,
    super.key,
  }) : pending = null;

  const MockTurnBubble.pending(PendingAnswer this.pending, {super.key})
    : turn = null,
      showAssessment = false;

  final MockTurn? turn;
  final PendingAnswer? pending;
  final bool showAssessment;

  @override
  Widget build(BuildContext context) {
    final t = turn;
    if (t != null && t.isInterviewer) return _interviewer(context, t);
    return _candidate(context);
  }

  Widget _interviewer(BuildContext context, MockTurn t) {
    final tone = LearnTone.of(context);
    final kind = _turnKindLabel(t.kind);
    return Padding(
      padding: const EdgeInsets.only(top: 10, bottom: 10, right: 24),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Avatar(),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  kind.isEmpty ? 'Interviewer' : 'Interviewer · $kind',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: tone.muted,
                  ),
                ),
                const SizedBox(height: 4),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: tone.raised,
                    border: Border.all(color: tone.line),
                    borderRadius: const BorderRadius.only(
                      topRight: Radius.circular(14),
                      bottomLeft: Radius.circular(14),
                      bottomRight: Radius.circular(14),
                      topLeft: Radius.circular(4),
                    ),
                  ),
                  child: SimpleMarkdown(t.text),
                ),
                if (t.problem != null) ...[
                  const SizedBox(height: 8),
                  CodingProblemCard(problem: t.problem!),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _candidate(BuildContext context) {
    final tone = LearnTone.of(context);
    final t = turn;
    final text = t?.text ?? pending!.text;
    final code = t?.code ?? pending?.code;
    final language = t?.codeLanguage ?? pending?.codeLanguage;
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 10, left: 40),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Text(
            pending != null ? 'You · sending…' : 'You',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w700,
              color: tone.muted,
            ),
          ),
          const SizedBox(height: 4),
          if (text.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: tone.accent.withValues(
                  alpha: pending != null ? 0.07 : 0.12,
                ),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(14),
                  bottomLeft: Radius.circular(14),
                  bottomRight: Radius.circular(14),
                  topRight: Radius.circular(4),
                ),
              ),
              child: Text(
                text,
                style: TextStyle(
                  fontSize: 14.5,
                  color: tone.strong,
                  height: 1.5,
                ),
              ),
            ),
          if (code != null) ...[
            const SizedBox(height: 6),
            CodeBlock(
              code,
              language: language == null ? null : _languageLabel(language),
            ),
          ],
          if (t?.language != null) ...[
            const SizedBox(height: 6),
            LanguageFeedback(language: t!.language!),
          ],
          if (showAssessment && t?.assessment != null) ...[
            const SizedBox(height: 6),
            AssessmentLine(assessment: t!.assessment!),
          ],
        ],
      ),
    );
  }
}

String _languageLabel(String value) =>
    mockCodeLanguages
        .where((l) => l.$1 == value.toLowerCase())
        .map((l) => l.$2)
        .firstOrNull ??
    value;

/// "Language looks good", or each correction: original → corrected, and why.
class LanguageFeedback extends StatelessWidget {
  const LanguageFeedback({required this.language, super.key});

  final TurnLanguage language;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    if (language.corrections.isEmpty) {
      if (!language.ok) return const SizedBox.shrink();
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.check_circle_outline,
            size: 14,
            color: LearnTone.pass,
          ),
          const SizedBox(width: 4),
          Text(
            'Language looks good',
            style: TextStyle(fontSize: 12, color: tone.muted),
          ),
        ],
      );
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: LearnTone.warn.withValues(alpha: 0.07),
        border: Border.all(color: LearnTone.warn.withValues(alpha: 0.3)),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.spellcheck, size: 14, color: LearnTone.warn),
              const SizedBox(width: 4),
              Text(
                'Language',
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: tone.body,
                ),
              ),
            ],
          ),
          for (final fix in language.corrections) ...[
            const SizedBox(height: 6),
            Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: fix.original,
                    style: TextStyle(
                      color: tone.fail,
                      decoration: TextDecoration.lineThrough,
                      decorationColor: tone.fail,
                    ),
                  ),
                  TextSpan(
                    text: ' → ',
                    style: TextStyle(color: tone.muted),
                  ),
                  TextSpan(
                    text: fix.corrected,
                    style: const TextStyle(
                      color: LearnTone.pass,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              style: const TextStyle(fontSize: 13, height: 1.4),
            ),
            if (fix.note.isNotEmpty)
              Text(
                fix.note,
                style: TextStyle(fontSize: 12, color: tone.muted, height: 1.4),
              ),
          ],
        ],
      ),
    );
  }
}

Color _assessmentColor(BuildContext context, String verdict) =>
    switch (verdict) {
      'STRONG' || 'CORRECT' => LearnTone.pass,
      'PARTIAL' => LearnTone.warn,
      _ => LearnTone.of(context).fail,
    };

/// How one answer went, after the interview.
class AssessmentLine extends StatelessWidget {
  const AssessmentLine({required this.assessment, super.key});

  final TurnAssessment assessment;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Tag(
          mockAssessmentLabel(assessment.verdict),
          color: _assessmentColor(context, assessment.verdict),
        ),
        if (assessment.note.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text(
            assessment.note,
            textAlign: TextAlign.right,
            style: TextStyle(fontSize: 12, color: tone.muted, height: 1.4),
          ),
        ],
      ],
    );
  }
}

/// The problem a coding question sets: title, statement, examples and
/// constraints.
class CodingProblemCard extends StatelessWidget {
  const CodingProblemCard({required this.problem, super.key});

  final CodingProblem problem;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final mono = TextStyle(
      fontFamily: 'monospace',
      fontSize: 12.5,
      color: tone.strong,
      height: 1.4,
    );
    return LearnPanel(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.code, size: 16, color: tone.accent),
              const SizedBox(width: 6),
              Text(
                'CODING PROBLEM',
                style: TextStyle(
                  fontSize: 10.5,
                  letterSpacing: 0.7,
                  fontWeight: FontWeight.w700,
                  color: tone.accent,
                ),
              ),
            ],
          ),
          if (problem.title.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              problem.title,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: tone.strong,
              ),
            ),
          ],
          if (problem.statement.isNotEmpty) ...[
            const SizedBox(height: 8),
            SimpleMarkdown(problem.statement, fontSize: 14),
          ],
          for (var i = 0; i < problem.examples.length; i++) ...[
            const SizedBox(height: 10),
            Text(
              'Example ${i + 1}',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: tone.body,
              ),
            ),
            const SizedBox(height: 4),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: tone.raised,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SelectableText(
                    'Input: ${problem.examples[i].input}',
                    style: mono,
                  ),
                  SelectableText(
                    'Output: ${problem.examples[i].output}',
                    style: mono,
                  ),
                  if (problem.examples[i].explanation != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      problem.examples[i].explanation!,
                      style: TextStyle(
                        fontSize: 12.5,
                        color: tone.muted,
                        height: 1.4,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
          if (problem.constraints.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              'Constraints',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: tone.body,
              ),
            ),
            const SizedBox(height: 4),
            for (final c in problem.constraints)
              Padding(
                padding: const EdgeInsets.only(bottom: 2),
                child: Text('• $c', style: mono.copyWith(fontSize: 12)),
              ),
          ],
        ],
      ),
    );
  }
}

/// The report: score and verdict, the summary, each dimension, strengths,
/// what to improve and next steps, the language, then question by question.
class MockReportView extends StatelessWidget {
  const MockReportView({required this.interview, super.key});

  final MockInterview interview;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final report = interview.report!;
    final verdictColor = mockVerdictIsPositive(report.verdict)
        ? LearnTone.pass
        : (report.verdict == 'LEAN_NO_HIRE' ? LearnTone.warn : tone.fail);
    final items = interview.reviewItems;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LearnPanel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  Text(
                    formatPrepScore(report.overallScore),
                    style: TextStyle(
                      fontSize: 34,
                      fontWeight: FontWeight.w800,
                      color: prepScoreColor(context, report.overallScore),
                      height: 1,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'overall',
                      style: TextStyle(fontSize: 12, color: tone.muted),
                    ),
                  ),
                  if (report.verdict.isNotEmpty)
                    Tag(
                      mockVerdictLabel(report.verdict),
                      color: verdictColor,
                      icon: mockVerdictIsPositive(report.verdict)
                          ? Icons.thumb_up_alt_outlined
                          : Icons.thumb_down_alt_outlined,
                    ),
                ],
              ),
              if (report.summary.isNotEmpty) ...[
                const SizedBox(height: 14),
                Text(
                  report.summary,
                  style: TextStyle(fontSize: 14, color: tone.body, height: 1.6),
                ),
              ],
            ],
          ),
        ),
        if (report.dimensions.isNotEmpty) ...[
          const SizedBox(height: 22),
          const SectionLabel('How you did'),
          for (final d in report.dimensions) _DimensionRow(dimension: d),
        ],
        LayoutBuilder(
          builder: (context, constraints) {
            final sections = [
              if (report.strengths.isNotEmpty)
                _Points(
                  label: 'Strengths',
                  items: report.strengths,
                  icon: Icons.check_circle_outline,
                  color: LearnTone.pass,
                ),
              if (report.improvements.isNotEmpty)
                _Points(
                  label: 'To improve',
                  items: report.improvements,
                  icon: Icons.trending_up,
                  color: LearnTone.warn,
                ),
              if (report.nextSteps.isNotEmpty)
                _Points(
                  label: 'Next steps',
                  items: report.nextSteps,
                  icon: Icons.arrow_forward,
                  color: tone.accent,
                ),
            ];
            if (sections.isEmpty) return const SizedBox.shrink();
            // Side by side on a wide screen (a tablet, landscape), stacked on a phone.
            if (constraints.maxWidth >= 720) {
              return Padding(
                padding: const EdgeInsets.only(top: 22),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (var i = 0; i < sections.length; i++) ...[
                      if (i > 0) const SizedBox(width: 16),
                      Expanded(child: sections[i]),
                    ],
                  ],
                ),
              );
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final s in sections)
                  Padding(padding: const EdgeInsets.only(top: 22), child: s),
              ],
            );
          },
        ),
        if (report.language.score != null ||
            report.language.note.isNotEmpty ||
            report.language.patterns.isNotEmpty) ...[
          const SizedBox(height: 22),
          const SectionLabel('Language'),
          LearnPanel(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (report.language.score != null)
                  Text(
                    formatPrepScore(report.language.score!),
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: prepScoreColor(context, report.language.score!),
                    ),
                  ),
                if (report.language.note.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(
                    report.language.note,
                    style: TextStyle(
                      fontSize: 13.5,
                      color: tone.body,
                      height: 1.5,
                    ),
                  ),
                ],
                if (report.language.patterns.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(
                    'Patterns to watch',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: tone.muted,
                    ),
                  ),
                  const SizedBox(height: 6),
                  PrepPoints(
                    report.language.patterns,
                    icon: Icons.spellcheck,
                    color: LearnTone.warn,
                  ),
                ],
              ],
            ),
          ),
        ],
        if (items.isNotEmpty) ...[
          const SizedBox(height: 22),
          SectionLabel('Question by question · ${items.length}'),
          for (var i = 0; i < items.length; i++)
            MockQuestionReviewCard(index: i, item: items[i]),
        ],
      ],
    );
  }
}

class _Points extends StatelessWidget {
  const _Points({
    required this.label,
    required this.items,
    required this.icon,
    required this.color,
  });

  final String label;
  final List<String> items;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      SectionLabel(label),
      PrepPoints(items, icon: icon, color: color),
    ],
  );
}

class _DimensionRow extends StatelessWidget {
  const _DimensionRow({required this.dimension});

  final MockDimension dimension;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final color = prepScoreColor(context, dimension.score);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  mockDimensionLabel(dimension.name),
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w600,
                    color: tone.strong,
                  ),
                ),
              ),
              Text(
                formatPrepScore(dimension.score),
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: color,
                ),
              ),
            ],
          ),
          const SizedBox(height: 5),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: (dimension.score / 10).clamp(0, 1).toDouble(),
              minHeight: 5,
              valueColor: AlwaysStoppedAnimation<Color>(color),
              backgroundColor: tone.line,
            ),
          ),
          if (dimension.comment.isNotEmpty) ...[
            const SizedBox(height: 5),
            Text(
              dimension.comment,
              style: TextStyle(fontSize: 12.5, color: tone.muted, height: 1.45),
            ),
          ],
        ],
      ),
    );
  }
}

/// One question from the report: what was asked, what was said, how it
/// went, and what a stronger answer would have said.
class MockQuestionReviewCard extends StatelessWidget {
  const MockQuestionReviewCard({
    required this.index,
    required this.item,
    super.key,
  });

  final int index;
  final MockReviewItem item;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final review = item.review;
    final question = item.question;
    final answer = item.answer;
    final assessment = answer?.assessment;
    Widget label(String text, IconData icon, Color color) => Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 4),
      child: Row(
        children: [
          Icon(icon, size: 15, color: color),
          const SizedBox(width: 6),
          Text(
            text,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: tone.body,
            ),
          ),
        ],
      ),
    );
    // A Material (not a decorated box) so the expandable "stronger answer"
    // can paint its ink.
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: tone.card,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: tone.line),
          borderRadius: BorderRadius.circular(14),
        ),
        clipBehavior: Clip.antiAlias,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(
                    'Q${index + 1}',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: tone.accent,
                    ),
                  ),
                  if (question != null &&
                      _turnKindLabel(question.kind).isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Text(
                      _turnKindLabel(question.kind),
                      style: TextStyle(fontSize: 11.5, color: tone.muted),
                    ),
                  ],
                  const Spacer(),
                  if (assessment != null) ...[
                    Tag(
                      mockAssessmentLabel(assessment.verdict),
                      color: _assessmentColor(context, assessment.verdict),
                    ),
                    const SizedBox(width: 8),
                  ],
                  Text(
                    formatPrepScore(review.score),
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w800,
                      color: prepScoreColor(context, review.score),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              if (question != null && question.text.isNotEmpty)
                SimpleMarkdown(question.text, fontSize: 14)
              else
                Text(
                  review.question,
                  style: TextStyle(
                    fontSize: 14,
                    color: tone.strong,
                    height: 1.5,
                  ),
                ),
              if (question?.problem != null &&
                  question!.problem!.title.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  'Problem: ${question.problem!.title}',
                  style: TextStyle(fontSize: 12.5, color: tone.muted),
                ),
              ],
              label('Your answer', Icons.person_outline, tone.muted),
              if (answer != null && answer.text.isNotEmpty)
                Container(
                  padding: const EdgeInsets.only(left: 12),
                  decoration: BoxDecoration(
                    border: Border(
                      left: BorderSide(color: tone.line, width: 2),
                    ),
                  ),
                  child: Text(
                    answer.text,
                    style: TextStyle(
                      fontSize: 13.5,
                      color: tone.body,
                      height: 1.5,
                    ),
                  ),
                )
              else if (answer?.code == null)
                Text(
                  review.answerSummary.isEmpty
                      ? 'No answer.'
                      : review.answerSummary,
                  style: TextStyle(
                    fontSize: 13.5,
                    color: tone.muted,
                    height: 1.5,
                  ),
                ),
              if (answer?.code != null) ...[
                const SizedBox(height: 6),
                CodeBlock(
                  answer!.code!,
                  language: answer.codeLanguage == null
                      ? null
                      : _languageLabel(answer.codeLanguage!),
                ),
              ],
              if (assessment != null && assessment.note.isNotEmpty) ...[
                const SizedBox(height: 6),
                Text(
                  assessment.note,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: tone.muted,
                    fontStyle: FontStyle.italic,
                    height: 1.45,
                  ),
                ),
              ],
              if (review.wentWell.isNotEmpty) ...[
                label('Went well', Icons.check_circle_outline, LearnTone.pass),
                Text(
                  review.wentWell,
                  style: TextStyle(
                    fontSize: 13.5,
                    color: tone.body,
                    height: 1.5,
                  ),
                ),
              ],
              if (review.couldBeBetter.isNotEmpty) ...[
                label('Could be better', Icons.trending_up, LearnTone.warn),
                Text(
                  review.couldBeBetter,
                  style: TextStyle(
                    fontSize: 13.5,
                    color: tone.body,
                    height: 1.5,
                  ),
                ),
              ],
              if (review.strongerAnswer.isNotEmpty)
                Theme(
                  data: Theme.of(context)
                      .copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 12),
                    expandedCrossAxisAlignment: CrossAxisAlignment.start,
                    leading: Icon(
                      Icons.lightbulb_outline,
                      size: 18,
                      color: tone.accent,
                    ),
                    title: Text(
                      'A stronger answer',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: tone.accent,
                      ),
                    ),
                    children: [
                      SimpleMarkdown(
                        review.strongerAnswer,
                        fontSize: 13.5,
                        color: tone.body,
                      ),
                    ],
                  ),
                )
              else
                const SizedBox(height: 10),
            ],
          ),
        ),
      ),
    );
  }
}
