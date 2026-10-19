import 'package:flutter/material.dart';

import '../models/interview_prep.dart';
import '../services/api_client.dart';
import '../widgets/common.dart';
import 'prep_widgets.dart';
import 'ui.dart';
import 'voice.dart';

/// Practising one interview-prep question: answer it typed or spoken, then
/// see the score, what was covered and missed, and the key points (shown
/// only after an attempt: reading them first turns practice into recital).
/// The answer can be tried again as often as wanted.
class PrepPracticePage extends StatefulWidget {
  const PrepPracticePage({required this.api, required this.prepId, required this.question, this.onAnswered, this.voice, super.key});

  final ApiClient api;
  final String prepId;
  final PrepQuestion question;

  /// Told about each graded answer, so the prep screen updates at once.
  final ValueChanged<PrepQuestion>? onAnswered;

  /// Injected so the screen is testable without a microphone.
  final VoiceInput? voice;

  @override
  State<PrepPracticePage> createState() => _PrepPracticePageState();
}

class _PrepPracticePageState extends State<PrepPracticePage> {
  late final VoiceInput _voice = widget.voice ?? PlatformVoiceInput();
  final _controller = TextEditingController();

  late PrepQuestion _question = widget.question;
  late bool _answering = !widget.question.isAnswered;
  bool _busy = false;
  bool _voiceReady = false;
  bool _listening = false;
  String? _error;

  /// What was typed before dictation started, so speech appends to it.
  String _textBeforeDictation = '';

  @override
  void initState() {
    super.initState();
    _voice.prepare().then((ready) {
      if (mounted) setState(() => _voiceReady = ready);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _voice.stop();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final text = _controller.text.trim();
    if (_busy) return;
    if (text.isEmpty) {
      setState(() => _error = 'Write or say your answer first.');
      return;
    }
    await _stopDictation();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final graded = await widget.api.answerPrepQuestion(widget.prepId, _question.id, text);
      if (!mounted) return;
      widget.onAnswered?.call(graded);
      _controller.clear();
      setState(() {
        _question = graded;
        _answering = false;
      });
    } catch (error) {
      // The answer stays in the box: losing what someone just said because
      // the laptop is off is the worst moment to lose it.
      if (mounted) setState(() => _error = prepErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _toggleDictation() async {
    if (_listening) {
      await _stopDictation();
      return;
    }
    _textBeforeDictation = _controller.text;
    setState(() => _listening = true);
    await _voice.start((transcript) {
      if (!mounted) return;
      final prefix = _textBeforeDictation.trim().isEmpty ? '' : '${_textBeforeDictation.trim()} ';
      _controller.value = TextEditingValue(text: '$prefix$transcript', selection: TextSelection.collapsed(offset: prefix.length + transcript.length));
    });
  }

  Future<void> _stopDictation() async {
    if (!_listening) return;
    await _voice.stop();
    if (mounted) setState(() => _listening = false);
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final q = _question;
    return Scaffold(
      appBar: AppBar(title: Text(prepKindLabel(q.kind))),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
        children: [
          Wrap(spacing: 6, runSpacing: 6, children: [
            if (q.topic.isNotEmpty) Tag(q.topic, color: tone.accent),
            Tag('Difficulty ${q.difficulty}/5', color: tone.muted),
          ]),
          const SizedBox(height: 12),
          Text(q.question, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: tone.strong, height: 1.5)),
          const SizedBox(height: 20),
          if (_answering) _composer(context) else _result(context),
        ],
      ),
    );
  }

  Widget _composer(BuildContext context) {
    final tone = LearnTone.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _controller,
          minLines: 6,
          maxLines: 16,
          keyboardType: TextInputType.multiline,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: 'Your answer',
            alignLabelWithHint: true,
            hintText: _listening ? 'Listening: say it as you would in the room.' : 'Answer as you would out loud.',
          ),
        ),
        const SizedBox(height: 8),
        if (_error != null) ...[
          Text(_error!, style: TextStyle(color: tone.fail, fontSize: 13, height: 1.4)),
          const SizedBox(height: 8),
        ],
        Row(children: [
          if (_voiceReady)
            IconButton(
              onPressed: _busy ? null : _toggleDictation,
              icon: Icon(_listening ? Icons.stop_circle_outlined : Icons.mic_none),
              color: _listening ? tone.accent : tone.muted,
              tooltip: _listening ? 'Stop dictating' : 'Dictate your answer',
            ),
          Expanded(
            child: Text(
              _voiceReady ? 'Dictation runs on your device. Only the text is sent.' : 'Type your answer, then submit it to be graded.',
              style: TextStyle(fontSize: 11.5, color: tone.muted),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton.icon(
            onPressed: _busy ? null : _submit,
            icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send, size: 18),
            label: Text(_busy ? 'Grading…' : 'Submit'),
          ),
        ]),
        if (_question.isAnswered && !_busy) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(onPressed: () => setState(() => _answering = false), child: const Text('Back to the last grade')),
          ),
        ],
      ],
    );
  }

  Widget _result(BuildContext context) {
    final tone = LearnTone.of(context);
    final q = _question;
    final score = q.score ?? 0;
    final feedback = q.feedback;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LearnPanel(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [
              Text(formatPrepScore(score), style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800, color: prepScoreColor(context, score), height: 1)),
              const SizedBox(width: 10),
              Expanded(child: Text('score', style: TextStyle(fontSize: 12, color: tone.muted))),
            ]),
            if (feedback != null && feedback.feedback.isNotEmpty) ...[
              const SizedBox(height: 12),
              Text(feedback.feedback, style: TextStyle(fontSize: 14, color: tone.body, height: 1.55)),
            ],
          ]),
        ),
        if (feedback != null && feedback.covered.isNotEmpty) ...[
          const SizedBox(height: 20),
          const SectionLabel('Covered'),
          PrepPoints(feedback.covered, icon: Icons.check_circle_outline, color: LearnTone.pass),
        ],
        if (feedback != null && feedback.missed.isNotEmpty) ...[
          const SizedBox(height: 16),
          const SectionLabel('Missed'),
          PrepPoints(feedback.missed, icon: Icons.radio_button_unchecked, color: LearnTone.warn),
        ],
        if (q.keyPoints != null && q.keyPoints!.isNotEmpty) ...[
          const SizedBox(height: 16),
          const SectionLabel('What a strong answer covers'),
          PrepPoints(q.keyPoints!),
        ],
        if (q.answer != null) ...[
          const SizedBox(height: 16),
          const SectionLabel('Your answer'),
          Container(
            padding: const EdgeInsets.only(left: 12),
            decoration: BoxDecoration(border: Border(left: BorderSide(color: tone.line, width: 2))),
            child: Text(q.answer!, style: TextStyle(fontSize: 14, color: tone.body, height: 1.55)),
          ),
        ],
        const SizedBox(height: 24),
        FilledButton.tonalIcon(
          onPressed: () => setState(() {
            _answering = true;
            _error = null;
          }),
          icon: const Icon(Icons.replay),
          label: const Text('Answer again'),
        ),
      ],
    );
  }
}
