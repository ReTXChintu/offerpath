import 'package:flutter/material.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../models/live_practice.dart';
import '../../services/api_client.dart';
import '../../state/live_practice_controller.dart';
import '../../widgets/common.dart';
import '../simple_markdown.dart';
import '../ui.dart';
import 'realtime_client.dart';
import 'voice_repository.dart';
import 'voice_setup_page.dart';

/// Keeps the screen on (or lets it sleep). Failures are ignored: a screen
/// that dims is no reason to stop practising.
typedef LiveWakelock = Future<void> Function(bool on);

Future<void> platformLiveWakelock(bool on) async {
  try {
    await WakelockPlus.toggle(enable: on);
  } catch (_) {}
}

/// One live-practice session: the phone on the table between two people.
/// The mic button starts and pauses listening. What's said shows as captions
/// labelled "Interviewer" or "You" (the phone knows the user's voice); when
/// the interviewer asks a question, a card shows it with a direct answer that
/// fills in as it's written (newest first). The screen stays on while
/// listening. An ended session shows its saved questions and answers.
class LivePracticePage extends StatefulWidget {
  const LivePracticePage({
    required this.api,
    required this.sessionId,
    this.initial,
    this.autoStart = false,
    this.mic,
    this.connect,
    this.wakelock = platformLiveWakelock,
    this.voice,
    super.key,
  });

  final ApiClient api;
  final String sessionId;
  final LivePracticeView? initial;

  /// Start listening at once (a session that was just created).
  final bool autoStart;

  /// The microphone (a fake in tests); the phone's by default.
  final LiveMic? mic;

  /// Opens the realtime socket (a fake in tests).
  final RealtimeConnector? connect;
  final LiveWakelock wakelock;

  /// The user's voice (fakes in tests); the server's and the phone's by
  /// default.
  final VoiceRepository? voice;

  @override
  State<LivePracticePage> createState() => _LivePracticePageState();
}

class _LivePracticePageState extends State<LivePracticePage>
    with WidgetsBindingObserver {
  late final VoiceRepository _voice =
      widget.voice ?? VoiceRepository(api: widget.api);
  late final LivePracticeController _c = LivePracticeController(
    api: widget.api,
    sessionId: widget.sessionId,
    initial: widget.initial,
    mic: widget.mic,
    connect: widget.connect,
    loadVoice: _voice.sessionVoice,
  );
  final _text = TextEditingController();
  bool _awake = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _c.addListener(_onChange);
    if (widget.initial == null) _c.load();
    if (widget.initial?.isEnded != true) _c.loadVoice();
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

  Future<void> _setUpVoice() async {
    await openVoiceSetup(context, _voice);
    if (mounted) await _c.reloadVoice();
  }

  Future<void> _ask() async {
    final text = _text.text;
    if (text.trim().isEmpty) return;
    if (await _c.ask(text) && mounted) _text.clear();
  }

  Future<void> _end() async {
    final ok = await confirmDialog(
      context,
      title: 'End this session?',
      message:
          'The microphone stops. The questions and answers so far stay saved.',
      confirm: 'End session',
    );
    if (ok) await _c.end();
  }

  Future<void> _delete() async {
    final ok = await confirmDialog(
      context,
      title: 'Delete this session?',
      message: 'Its questions and answers go with it.',
      confirm: 'Delete',
    );
    if (!ok || !mounted) return;
    if (await _c.delete() && mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final view = _c.view;
    return Scaffold(
      appBar: AppBar(
        title: Text(view?.title ?? 'Live practice'),
        actions: [
          if (view != null)
            PopupMenuButton<String>(
              onSelected: (v) => v == 'end' ? _end() : _delete(),
              itemBuilder: (_) => [
                if (view.isActive)
                  const PopupMenuItem(value: 'end', child: Text('End session')),
                const PopupMenuItem(value: 'delete', child: Text('Delete')),
              ],
            ),
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
    final cards = view.isActive ? _c.cards : const <LiveCard>[];
    final saved = view.isActive
        ? _c.earlierExchanges
        : view.exchanges.reversed.toList();
    return Column(
      children: [
        if (_c.banner != null)
          InlineNotice(
            key: const ValueKey('live-banner'),
            icon: Icons.error_outline,
            text: _c.banner!,
            color: tone.fail,
            trailing: InkWell(
              onTap: _c.dismissBanner,
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
                if (view.isActive && _c.showVoiceHint) ...[
                  _VoiceHint(onSetUp: _setUpVoice),
                  const SizedBox(height: 12),
                ],
                view.isActive
                    ? _MicPanel(controller: _c, onEnd: _end)
                    : _SummaryPanel(view: view),
                const SizedBox(height: 20),
                SectionLabel('Questions · ${cards.length + saved.length}'),
                if (cards.isEmpty && saved.isEmpty)
                  Text(
                    view.isActive
                        ? "No questions yet. When the interviewer asks one out loud, the answer shows up here."
                        : 'No questions were answered in this session.',
                    style: TextStyle(
                      fontSize: 13,
                      color: tone.muted,
                      height: 1.5,
                    ),
                  ),
                for (final card in cards)
                  LiveAnswerCard(
                    key: ValueKey(card.id),
                    question: card.question,
                    answer: card.answer,
                    writing: !card.answerDone,
                    waitingForQuestion: !card.questionDone,
                    saveError: card.save == LiveSaveState.failed
                        ? (card.saveError ?? "Couldn't save it.")
                        : null,
                    onRetrySave: () => _c.retrySave(card),
                  ),
                for (final e in saved)
                  LiveAnswerCard(
                    key: ValueKey('x-${e.id}'),
                    question: e.question,
                    answer: e.answer,
                    answerFor: e.answerFor,
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
                maxLength: 2000,
                textInputAction: TextInputAction.send,
                onSubmitted: (_) => _ask(),
                decoration: const InputDecoration(
                  hintText: 'Type a question',
                  counterText: '',
                  isDense: true,
                  border: InputBorder.none,
                ),
              ),
            ),
            IconButton(
              onPressed: _c.asking > 0 ? null : _ask,
              tooltip: 'Ask',
              icon: _c.asking > 0
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

/// The big mic button, the level meter, what's happening, and the live
/// caption.
class _MicPanel extends StatelessWidget {
  const _MicPanel({required this.controller, required this.onEnd});

  final LivePracticeController controller;
  final VoidCallback onEnd;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final c = controller;
    final on = c.listening;
    final title = c.startingMic
        ? 'Starting…'
        : on
        ? 'Listening'
        : 'Paused';
    final status = switch (c.connection) {
      LiveConnection.connecting => 'Connecting…',
      LiveConnection.reconnecting => 'Reconnecting…',
      _ when !on => 'Tap the mic to listen.',
      _ => switch (c.conversation.speech) {
        LiveSpeech.hearing => 'Listening…',
        LiveSpeech.thinking => 'Thinking…',
        LiveSpeech.quiet =>
          c.conversation.answering ? 'Thinking…' : 'Ask any question.',
      },
    };
    final lines = c.conversation.transcript;
    final recent = lines.length > 4 ? lines.sublist(lines.length - 4) : lines;
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
                      title,
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: on ? tone.accent : tone.strong,
                      ),
                    ),
                    const SizedBox(height: 8),
                    ValueListenableBuilder<double>(
                      valueListenable: c.level,
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
                    Row(
                      children: [
                        if (c.connection == LiveConnection.connecting ||
                            c.connection == LiveConnection.reconnecting) ...[
                          const SizedBox(
                            width: 12,
                            height: 12,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                          const SizedBox(width: 8),
                        ],
                        Flexible(
                          child: Text(
                            status,
                            style: TextStyle(fontSize: 12, color: tone.muted),
                          ),
                        ),
                      ],
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
          if (recent.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              key: const ValueKey('live-transcript'),
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              decoration: BoxDecoration(
                color: tone.raised,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final line in recent)
                    _CaptionLine(
                      key: ValueKey('line-${line.itemId}'),
                      turn: line,
                      knowsVoices: c.voice != null,
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 10),
          Text(
            "Put the phone between you. You're the interviewee: only the interviewer's questions get answers. For practice with a partner only.",
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

/// An ended session.
class _SummaryPanel extends StatelessWidget {
  const _SummaryPanel({required this.view});

  final LivePracticeView view;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final n = view.exchanges.length;
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
          const SizedBox(height: 4),
          Text(
            n == 1 ? '1 question answered' : '$n questions answered',
            style: TextStyle(fontSize: 13, color: tone.muted),
          ),
        ],
      ),
    );
  }
}

/// "Set up your voice so only the interviewer gets answers".
class _VoiceHint extends StatelessWidget {
  const _VoiceHint({required this.onSetUp});

  final VoidCallback onSetUp;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Container(
      key: const ValueKey('live-voice-hint'),
      padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
      decoration: BoxDecoration(
        color: LearnTone.warn.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          const Icon(Icons.record_voice_over, size: 18, color: LearnTone.warn),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              liveVoiceHint,
              style: TextStyle(fontSize: 12.5, color: tone.body, height: 1.4),
            ),
          ),
          TextButton(onPressed: onSetUp, child: const Text('Set up')),
        ],
      ),
    );
  }
}

/// One caption: who said it, and what.
class _CaptionLine extends StatelessWidget {
  const _CaptionLine({
    required this.turn,
    required this.knowsVoices,
    super.key,
  });

  final LiveTurn turn;

  /// The user's voice is recognised (else every turn is just "heard").
  final bool knowsVoices;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final (label, color) = switch (turn.role) {
      LiveRole.interviewee => ('You', LearnTone.pass),
      LiveRole.interviewer when knowsVoices => ('Interviewer', tone.accent),
      LiveRole.interviewer => ('Heard', tone.muted),
      null => ('…', tone.muted),
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 84),
            child: Align(
              alignment: Alignment.centerLeft,
              widthFactor: 1,
              child: Tag(label, color: color),
            ),
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              turn.text.trim(),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 13,
                color: tone.body,
                fontStyle: FontStyle.italic,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One question and its answer (still being written while [writing]).
class LiveAnswerCard extends StatelessWidget {
  const LiveAnswerCard({
    required this.question,
    required this.answer,
    this.answerFor = AnswerFor.me,
    this.writing = false,
    this.waitingForQuestion = false,
    this.saveError,
    this.onRetrySave,
    super.key,
  });

  final String question;
  final String answer;

  /// `neutral` only on exchanges saved before answers were always the
  /// user's.
  final AnswerFor answerFor;
  final bool writing;

  /// The question's transcript isn't in yet.
  final bool waitingForQuestion;

  /// Why saving it failed; null when it's fine.
  final String? saveError;
  final VoidCallback? onRetrySave;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final q = question.trim();
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
          Text(
            q.isNotEmpty
                ? q
                : waitingForQuestion
                ? 'Catching the question…'
                : liveQuestionNotCaptured,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: q.isNotEmpty ? tone.strong : tone.muted,
              fontStyle: q.isNotEmpty ? null : FontStyle.italic,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 10),
          SimpleMarkdown(answer.trim(), fontSize: 14.5),
          if (writing || answerFor == AnswerFor.neutral || saveError != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                children: [
                  if (writing) ...[
                    const SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      'Writing…',
                      style: TextStyle(fontSize: 12, color: tone.muted),
                    ),
                    const SizedBox(width: 10),
                  ],
                  if (answerFor == AnswerFor.neutral)
                    Tag('Neutral', color: tone.muted),
                  if (saveError != null) ...[
                    const Spacer(),
                    Flexible(
                      flex: 4,
                      child: Text(
                        'Not saved: $saveError',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.end,
                        style: TextStyle(fontSize: 12, color: tone.fail),
                      ),
                    ),
                    if (onRetrySave != null)
                      TextButton(
                        onPressed: onRetrySave,
                        style: TextButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                        child: const Text('Retry'),
                      ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}
