import 'package:flutter/material.dart';

import '../services/api_client.dart';
import 'models.dart';
import 'ui.dart';
import 'voice.dart';

/// A live mock interview, spoken or typed. Ported from ForgeRoutine's app.
///
/// Deliberately bare: one question, one box, no scores, no countdown to a
/// grade. Feedback between turns would turn this into a tutorial, and the
/// user would start answering for approval rather than saying what they
/// actually think.
///
/// The phone is arguably the better device for this: an interview is
/// spoken, and dictating an answer while walking is far closer to the real
/// thing than typing one at a desk.
class InterviewSessionPage extends StatefulWidget {
  const InterviewSessionPage({required this.api, required this.interviewId, this.voice, super.key});

  final ApiClient api;
  final String interviewId;

  /// Injected so the screen is testable without a microphone.
  final VoiceInput? voice;

  @override
  State<InterviewSessionPage> createState() => _InterviewSessionPageState();
}

class _InterviewSessionPageState extends State<InterviewSessionPage> {
  late final VoiceInput _voice = widget.voice ?? PlatformVoiceInput();
  final _controller = TextEditingController();
  final _scroll = ScrollController();

  Interview? _interview;
  InterviewReport? _report;
  bool _busy = false;
  bool _voiceReady = false;
  bool _listening = false;
  String? _error;

  /// What was typed before dictation started, so speech appends rather than
  /// replacing an answer the user had already begun.
  String _textBeforeDictation = '';

  String get _base => '/interviews/${Uri.encodeComponent(widget.interviewId)}';

  @override
  void initState() {
    super.initState();
    _load();
    _voice.prepare().then((ready) {
      if (mounted) setState(() => _voiceReady = ready);
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _voice.stop();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final json = await widget.api.get(_base);
      if (!mounted) return;
      final interview = Interview.fromJson((json as Map).cast<String, dynamic>());
      setState(() {
        _interview = interview;
        _error = null;
      });
      if (interview.isFinished) await _loadReport();
    } catch (error) {
      if (mounted) setState(() => _error = learnErrorMessage(error));
    }
  }

  Future<void> _loadReport() async {
    try {
      final json = await widget.api.get('$_base/report', timeout: ApiClient.aiTimeout);
      if (mounted) setState(() => _report = InterviewReport.fromJson((json as Map).cast<String, dynamic>()));
    } catch (_) {
      // A missing report is not worth an error screen: the transcript is
      // still the useful part.
    }
  }

  Future<void> _send() async {
    final interview = _interview;
    final questionId = interview?.currentQuestionId;
    final text = _controller.text.trim();
    if (interview == null || questionId == null || text.isEmpty || _busy) return;

    await _stopDictation();
    setState(() {
      _busy = true;
      _error = null;
    });
    _controller.clear();

    try {
      final json = await widget.api.post('$_base/answer', body: {'questionId': questionId, 'text': text}, timeout: ApiClient.aiTimeout);
      if (!mounted) return;
      final next = Interview.fromJson((json as Map).cast<String, dynamic>());
      setState(() => _interview = next);
      if (next.isFinished) await _loadReport();
      _scrollToEnd();
    } catch (error) {
      if (mounted) {
        // Put the answer back: losing what someone just said because the
        // network (or the desktop) dropped is the worst moment to lose it.
        _controller.text = text;
        setState(() => _error = learnErrorMessage(error));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _end() async {
    setState(() => _busy = true);
    try {
      final json = await widget.api.post('$_base/end', timeout: ApiClient.aiTimeout);
      if (!mounted) return;
      setState(() => _report = InterviewReport.fromJson((json as Map).cast<String, dynamic>()));
      await _load();
    } catch (error) {
      if (mounted) setState(() => _error = learnErrorMessage(error));
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
      final prefix = _textBeforeDictation.isEmpty ? '' : '${_textBeforeDictation.trim()} ';
      _controller.value = TextEditingValue(text: '$prefix$transcript', selection: TextSelection.collapsed(offset: prefix.length + transcript.length));
    });
  }

  Future<void> _stopDictation() async {
    if (!_listening) return;
    await _voice.stop();
    if (mounted) setState(() => _listening = false);
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final interview = _interview;
    return Scaffold(
      appBar: AppBar(
        title: Text(interview == null ? 'Interview' : '${interview.mode.replaceAll('_', ' ')} interview'),
        actions: [
          if (interview != null && !interview.isFinished) TextButton(onPressed: _busy ? null : _end, child: const Text('End')),
        ],
      ),
      body: interview == null
          ? Center(
              child: _error == null
                  ? const CircularProgressIndicator()
                  : Padding(padding: const EdgeInsets.all(32), child: Text(_error!, textAlign: TextAlign.center, style: TextStyle(color: tone.fail))),
            )
          : Column(children: [
              Expanded(
                child: ListView(
                  controller: _scroll,
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                  children: [
                    for (final turn in interview.turns) _Turn(turn: turn),
                    if (_busy && !interview.isFinished)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        child: Row(children: [
                          const SizedBox(height: 12, width: 12, child: CircularProgressIndicator(strokeWidth: 2)),
                          const SizedBox(width: 10),
                          Text('Thinking about your answer…', style: TextStyle(fontSize: 12, color: tone.muted)),
                        ]),
                      ),
                    if (_report != null) _Debrief(report: _report!),
                  ],
                ),
              ),
              if (!interview.isFinished) _composer(interview),
            ]),
    );
  }

  Widget _composer(Interview interview) {
    final tone = LearnTone.of(context);
    return Container(
      padding: EdgeInsets.only(left: 16, right: 16, top: 12, bottom: MediaQuery.of(context).padding.bottom + 12),
      decoration: BoxDecoration(color: tone.card, border: Border(top: BorderSide(color: tone.line))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            Text(_error!, style: TextStyle(color: tone.fail, fontSize: 12)),
            const SizedBox(height: 8),
          ],
          TextField(
            controller: _controller,
            minLines: 3,
            maxLines: 8,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: _listening ? 'Listening — say it as you would out loud.' : 'Answer as you would out loud.',
              hintStyle: TextStyle(color: _listening ? tone.accent : tone.muted, fontSize: 13),
            ),
          ),
          const SizedBox(height: 8),
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
                // Said plainly, because asking for a microphone deserves a
                // plain answer about what happens to the audio.
                _voiceReady ? 'Dictation runs on your device. Only the text is sent.' : 'Nothing is graded in front of you — the debrief comes at the end.',
                style: TextStyle(fontSize: 11, color: tone.muted),
              ),
            ),
            FilledButton(onPressed: _busy ? null : _send, child: const Text('Send')),
          ]),
          const SizedBox(height: 4),
          Text('Up to ${interview.turnsRemaining} questions left.', style: TextStyle(fontSize: 11, color: tone.muted)),
        ],
      ),
    );
  }
}

class _Turn extends StatelessWidget {
  const _Turn({required this.turn});

  final InterviewTurn turn;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (turn.conceptName != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 5),
            child: Text(turn.conceptName!.toUpperCase(), style: TextStyle(fontSize: 10, letterSpacing: 0.7, color: tone.muted)),
          ),
        Text(turn.prompt, style: TextStyle(fontSize: 15, color: tone.strong, height: 1.55)),
        if (turn.answer != null) ...[
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.only(left: 12),
            decoration: BoxDecoration(border: Border(left: BorderSide(color: tone.line, width: 2))),
            child: Text(turn.answer!, style: TextStyle(fontSize: 14, color: tone.body, height: 1.55)),
          ),
        ],
      ]),
    );
  }
}

class _Debrief extends StatelessWidget {
  const _Debrief({required this.report});

  final InterviewReport report;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    // Only dimensions the interview actually tested. The rest are omitted
    // rather than shown at zero: a zero reads as "bad at this" when the truth
    // is "never asked about this".
    final scored = report.dimensions.entries.where((entry) => entry.value != null).map((entry) => MapEntry(entry.key, entry.value!)).toList();

    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.only(top: 20),
      decoration: BoxDecoration(border: Border(top: BorderSide(color: tone.line))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text('Debrief', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: tone.strong)),
            if (report.overallScore != null) Text('${(report.overallScore! * 100).round()}%', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: tone.accent)),
          ],
        ),
        const SizedBox(height: 12),
        if (report.degraded)
          const Padding(
            padding: EdgeInsets.only(bottom: 12),
            child: Text('This debrief is the arithmetic only — the written review could not be generated.', style: TextStyle(fontSize: 12, color: LearnTone.warn, height: 1.5)),
          ),
        if (report.summary != null) Text(report.summary!, style: TextStyle(fontSize: 14, color: tone.body, height: 1.6)),
        if (scored.isNotEmpty) ...[
          const SizedBox(height: 20),
          const SectionLabel('Scored'),
          for (final entry in scored)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(children: [
                SizedBox(width: 140, child: Text(_humanise(entry.key), style: TextStyle(fontSize: 12, color: tone.muted))),
                Expanded(
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(99),
                    child: LinearProgressIndicator(
                      value: entry.value,
                      minHeight: 4,
                      valueColor: AlwaysStoppedAnimation<Color>(entry.value >= 0.7 ? LearnTone.pass : (entry.value >= 0.45 ? LearnTone.warn : tone.fail)),
                    ),
                  ),
                ),
                SizedBox(width: 34, child: Text('${(entry.value * 100).round()}', textAlign: TextAlign.right, style: TextStyle(fontSize: 12, color: tone.muted))),
              ]),
            ),
          const SizedBox(height: 4),
          Text('Dimensions this interview did not test are left out, not scored zero.', style: TextStyle(fontSize: 11, color: tone.muted, height: 1.5)),
        ],
        if (report.strongAreas.isNotEmpty) ...[const SizedBox(height: 20), const SectionLabel('Held up'), for (final area in report.strongAreas) _Bullet(area)],
        if (report.weakAreas.isNotEmpty) ...[const SizedBox(height: 20), const SectionLabel('Did not'), for (final area in report.weakAreas) _Bullet(area)],
        if (report.recommendedTopics.isNotEmpty) ...[
          const SizedBox(height: 20),
          const SectionLabel('Study next'),
          Text(report.recommendedTopics.join(' · '), style: TextStyle(fontSize: 13, color: tone.body, height: 1.6)),
        ],
      ]),
    );
  }
}

class _Bullet extends StatelessWidget {
  const _Bullet(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text('· $text', style: TextStyle(fontSize: 13, color: LearnTone.of(context).body, height: 1.5)),
    );
  }
}

String _humanise(String dimension) {
  final spaced = dimension.replaceAllMapped(RegExp('([A-Z])'), (match) => ' ${match[1]}');
  return spaced.isEmpty ? spaced : spaced[0].toUpperCase() + spaced.substring(1).trim();
}
