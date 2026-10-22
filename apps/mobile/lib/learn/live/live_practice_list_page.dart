import 'dart:async';

import 'package:flutter/material.dart';

import '../../models/live_practice.dart';
import '../../services/api_client.dart';
import '../../util/format.dart';
import '../../widgets/common.dart';
import '../ui.dart';
import 'live_practice_page.dart';
import 'voice_repository.dart';
import 'voice_setup_page.dart';

/// Where to add the OpenAI key: the phone has no AI settings of its own.
const liveOpenAiKeyHint =
    'Add your OpenAI key in Settings → AI on the web or laptop app.';

/// Opens a session's screen. Before a new one ([autoStart]), the voice
/// setup comes first when there's no voiceprint and it hasn't been offered
/// on this phone yet.
Future<void> openLivePractice(
  BuildContext context,
  ApiClient api,
  String sessionId, {
  LivePracticeView? initial,
  bool autoStart = false,
  VoiceRepository? voice,
}) async {
  final repo = voice ?? VoiceRepository(api: api);
  if (autoStart && await repo.offerSetup() && context.mounted) {
    await openVoiceSetup(context, repo, beforeSession: true);
  }
  if (!context.mounted) return;
  await Navigator.of(context).push(
    MaterialPageRoute<void>(
      builder: (_) => LivePracticePage(
        api: api,
        sessionId: sessionId,
        initial: initial,
        autoStart: autoStart,
        voice: repo,
      ),
    ),
  );
}

/// Live practice can't start: says why and where to fix it.
Future<void> showLiveNotReady(BuildContext context, String? reason) =>
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Live practice needs your OpenAI key'),
        content: Text(
          [
            if (reason != null && reason.trim().isNotEmpty) reason.trim(),
            liveOpenAiKeyHint,
          ].join('\n\n'),
        ),
        actions: [
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('OK'),
          ),
        ],
      ),
    );

/// Learn > Live practice: "Your voice", past sessions (newest first) and
/// "New live practice".
class LivePracticeListPage extends StatefulWidget {
  const LivePracticeListPage({required this.api, this.voice, super.key});

  final ApiClient api;

  /// The user's voice (fakes in tests).
  final VoiceRepository? voice;

  @override
  State<LivePracticeListPage> createState() => _LivePracticeListPageState();
}

class _LivePracticeListPageState extends State<LivePracticeListPage> {
  late final VoiceRepository _voice =
      widget.voice ?? VoiceRepository(api: widget.api);
  List<LivePracticeSummary>? _sessions;
  Object? _error;

  /// Whether a voiceprint is saved; null while unknown.
  bool? _voiceSetUp;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _loadVoice() async {
    try {
      final profile = await widget.api.getVoiceProfile();
      if (mounted) setState(() => _voiceSetUp = profile != null);
    } catch (_) {
      // The card stays as it was.
    }
  }

  Future<void> _openVoice() async {
    await openVoiceSetup(context, _voice);
    await _loadVoice();
  }

  Future<void> _load() async {
    unawaited(_loadVoice());
    try {
      final sessions = await widget.api.listLivePractice();
      if (!mounted) return;
      setState(() {
        _sessions = sessions;
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _new() async {
    final view = await showModalBottomSheet<LivePracticeView>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => NewLivePracticeSheet(api: widget.api),
    );
    if (view == null || !mounted) return;
    await openLivePractice(
      context,
      widget.api,
      view.id,
      initial: view,
      autoStart: true,
      voice: _voice,
    );
    await _load();
  }

  Future<void> _open(LivePracticeSummary s) async {
    await openLivePractice(context, widget.api, s.id, voice: _voice);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final sessions = _sessions;
    if (sessions == null && _error == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (sessions == null) {
      return RefreshIndicator(
        onRefresh: _load,
        child: LearnMessage(
          icon: Icons.error_outline,
          title: 'Could not load live practice',
          body: liveErrorMessage(_error),
          action: 'Try again',
          onAction: _load,
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
        children: [
          _VoiceCard(setUp: _voiceSetUp, onTap: _openVoice),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _new,
            icon: const Icon(Icons.mic),
            label: const Text('New live practice'),
          ),
          const SizedBox(height: 16),
          if (sessions.isEmpty)
            LearnPanel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Practise with a partner',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: tone.strong,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    "Put the phone on the table: you're the interviewee and your partner is the interviewer. "
                    'It listens all the time and knows your voice, so whenever the interviewer asks a question, a direct answer from your CV shows up within seconds. '
                    'Every question and answer is saved. Uses your own OpenAI key. For practice only, never for a real interview.',
                    style: TextStyle(
                      fontSize: 13,
                      color: tone.muted,
                      height: 1.5,
                    ),
                  ),
                ],
              ),
            )
          else ...[
            const SectionLabel('Sessions'),
            for (final s in sessions)
              _SessionTile(session: s, onTap: () => _open(s)),
          ],
        ],
      ),
    );
  }
}

/// "Your voice": set up or not; opens the voice setup.
class _VoiceCard extends StatelessWidget {
  const _VoiceCard({required this.setUp, required this.onTap});

  final bool? setUp;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final on = setUp == true;
    return Material(
      key: const ValueKey('live-voice-card'),
      color: tone.card,
      shape: RoundedRectangleBorder(
        side: BorderSide(color: tone.line),
        borderRadius: BorderRadius.circular(12),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Row(
            children: [
              Icon(
                Icons.record_voice_over,
                color: on ? LearnTone.pass : tone.muted,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          'Your voice',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: tone.strong,
                          ),
                        ),
                        const SizedBox(width: 8),
                        if (setUp != null)
                          Tag(
                            on ? 'Set up' : 'Not set up',
                            color: on ? LearnTone.pass : LearnTone.warn,
                          ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      on
                          ? "Only the interviewer's questions get answers. Test or record it again."
                          : 'Set it up so only the interviewer gets answers.',
                      style: TextStyle(fontSize: 12, color: tone.muted),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, size: 20, color: tone.muted),
            ],
          ),
        ),
      ),
    );
  }
}

class _SessionTile extends StatelessWidget {
  const _SessionTile({required this.session, required this.onTap});

  final LivePracticeSummary session;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final n = session.exchanges;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: tone.card,
        shape: RoundedRectangleBorder(
          side: BorderSide(color: tone.line),
          borderRadius: BorderRadius.circular(12),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              session.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                                color: tone.strong,
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          session.status == LiveStatus.active
                              ? Tag('Live', color: tone.accent)
                              : Tag('Ended', color: tone.muted),
                        ],
                      ),
                      const SizedBox(height: 3),
                      Text(
                        [
                          formatDateTime(context, session.createdAt),
                          n == 1 ? '1 question' : '$n questions',
                        ].where((p) => p.isNotEmpty).join(' · '),
                        style: TextStyle(fontSize: 12, color: tone.muted),
                      ),
                    ],
                  ),
                ),
                Icon(Icons.chevron_right, size: 20, color: tone.muted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Starts a session from the Learn tab: optional technologies and title.
/// Says so up front when no OpenAI key is saved. Pops with the new session.
class NewLivePracticeSheet extends StatefulWidget {
  const NewLivePracticeSheet({required this.api, super.key});

  final ApiClient api;

  @override
  State<NewLivePracticeSheet> createState() => _NewLivePracticeSheetState();
}

class _NewLivePracticeSheetState extends State<NewLivePracticeSheet> {
  late final Future<LiveReady> _ready = widget.api.livePracticeReady();
  final _title = TextEditingController();
  final _tech = TextEditingController();
  final List<String> _techs = [];
  bool _starting = false;
  String? _error;

  @override
  void dispose() {
    _title.dispose();
    _tech.dispose();
    super.dispose();
  }

  /// Moves what's typed (comma separated) into chips.
  void _addTech([String? raw]) {
    final parts = (raw ?? _tech.text)
        .split(',')
        .map((s) => s.trim())
        .where((s) => s.isNotEmpty);
    setState(() {
      for (final p in parts) {
        if (!_techs.any((t) => t.toLowerCase() == p.toLowerCase())) {
          _techs.add(p);
        }
      }
      _tech.clear();
    });
  }

  Future<void> _start() async {
    _addTech();
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      final view = await widget.api.startLivePractice(
        technologies: _techs,
        title: _title.text,
      );
      if (mounted) Navigator.of(context).pop(view);
    } catch (error) {
      if (mounted) {
        setState(() {
          _starting = false;
          _error = liveErrorMessage(error);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        child: FutureBuilder<LiveReady>(
          future: _ready,
          builder: (context, snapshot) {
            final ready = snapshot.data;
            final notReady = ready != null && !ready.ready;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'New live practice',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: tone.strong,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Both optional: the technologies steer the answers, the title names the session.',
                  style: TextStyle(fontSize: 12.5, color: tone.muted),
                ),
                if (notReady)
                  Callout(
                    icon: Icons.key_off_outlined,
                    color: tone.fail,
                    title: 'Live practice needs your OpenAI key',
                    message: [
                      if (ready.reason != null) ready.reason!,
                      liveOpenAiKeyHint,
                    ].join('\n\n'),
                  ),
                if (snapshot.hasError)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      liveErrorMessage(snapshot.error),
                      style: TextStyle(color: tone.fail),
                    ),
                  ),
                const SizedBox(height: 16),
                TextField(
                  controller: _tech,
                  textInputAction: TextInputAction.done,
                  onChanged: (v) {
                    if (v.endsWith(',')) _addTech(v);
                  },
                  onSubmitted: (v) => _addTech(v),
                  decoration: const InputDecoration(
                    labelText: 'Technologies',
                    hintText: 'React, Node.js, SQL',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_techs.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final t in _techs)
                        InputChip(
                          label: Text(t),
                          onDeleted: () => setState(() => _techs.remove(t)),
                        ),
                    ],
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _title,
                  textInputAction: TextInputAction.done,
                  decoration: const InputDecoration(
                    labelText: 'Title',
                    hintText: 'Live practice',
                    border: OutlineInputBorder(),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Text(_error!, style: TextStyle(color: tone.fail)),
                ],
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed:
                      _starting ||
                          notReady ||
                          (ready == null && !snapshot.hasError)
                      ? null
                      : _start,
                  style: FilledButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                  icon: _starting
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.mic),
                  label: const Text('Start'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
