import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/api_client.dart';
import 'models.dart';
import 'ui.dart';

/// Reading a concept, and asking the tutor about it.
///
/// The explanation is written once per concept (by Claude on a desktop) and
/// shared; the conversation is this user's own. Both come from the user's
/// desktop when they're new, so with the desktop off the page says so
/// instead of failing: "Your desktop is offline: AI answers come back when
/// it's on". What was already written still shows.
class ConceptPage extends StatefulWidget {
  const ConceptPage({required this.api, required this.conceptId, this.title, super.key});

  final ApiClient api;
  final String conceptId;
  final String? title;

  @override
  State<ConceptPage> createState() => _ConceptPageState();
}

class _ConceptPageState extends State<ConceptPage> {
  final _question = TextEditingController();
  final _scroll = ScrollController();

  ConceptInfo? _concept;
  Explainer? _explainer;
  Object? _explainerError;
  bool _explainerLoading = true;
  List<ChatMessage> _chat = const [];
  bool _asking = false;
  String? _askError;
  Object? _loadError;

  String get _base => '/concepts/${Uri.encodeComponent(widget.conceptId)}';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _question.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loadError = null;
      _explainerError = null;
      _explainerLoading = true;
    });
    try {
      final detail = await widget.api.get(_base);
      if (!mounted) return;
      setState(() => _concept = ConceptInfo.fromJson((detail as Map).cast<String, dynamic>()));
    } catch (e) {
      if (mounted) setState(() => _loadError = e);
      return;
    }
    await Future.wait([_loadExplainer(), _loadChat()]);
  }

  Future<void> _loadExplainer() async {
    try {
      final json = await widget.api.get('$_base/explainer', timeout: ApiClient.aiTimeout);
      if (mounted) setState(() => _explainer = Explainer.fromJson((json as Map).cast<String, dynamic>()));
    } catch (e) {
      if (mounted) setState(() => _explainerError = e);
    } finally {
      if (mounted) setState(() => _explainerLoading = false);
    }
  }

  Future<void> _loadChat() async {
    try {
      final json = await widget.api.get('$_base/chat');
      if (mounted) setState(() => _chat = _messages(json));
    } catch (_) {
      // The conversation is optional on this page; asking still works.
    }
  }

  List<ChatMessage> _messages(Object? json) => (json as List<dynamic>? ?? const []).map((e) => ChatMessage.fromJson((e as Map).cast<String, dynamic>())).toList();

  Future<void> _ask() async {
    final text = _question.text.trim();
    if (text.isEmpty || _asking) return;
    setState(() {
      _asking = true;
      _askError = null;
    });
    try {
      final json = await widget.api.post('$_base/chat', body: {'question': text}, timeout: ApiClient.aiTimeout);
      if (!mounted) return;
      _question.clear();
      setState(() => _chat = [..._chat, ..._messages(json)]);
      _scrollToEnd();
    } catch (e) {
      // The question stays in the box, so nothing typed is lost.
      if (mounted) setState(() => _askError = learnErrorMessage(e));
    } finally {
      if (mounted) setState(() => _asking = false);
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    });
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final concept = _concept;
    return Scaffold(
      appBar: AppBar(title: Text(concept?.name ?? widget.title ?? 'Concept', maxLines: 1, overflow: TextOverflow.ellipsis)),
      body: _loadError != null
          ? LearnErrorView(title: 'Could not open this concept', error: _loadError, onRetry: _load)
          : concept == null
              ? const Center(child: CircularProgressIndicator())
              : Column(children: [
                  Expanded(
                    child: ListView(
                      controller: _scroll,
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                      children: [
                        if (concept.technologyName.isNotEmpty) Text(concept.technologyName.toUpperCase(), style: TextStyle(fontSize: 11, letterSpacing: 0.8, fontWeight: FontWeight.w700, color: tone.accent)),
                        const SizedBox(height: 4),
                        Text(concept.name, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: tone.strong)),
                        if (concept.description.isNotEmpty) ...[
                          const SizedBox(height: 8),
                          Text(concept.description, style: TextStyle(fontSize: 14, color: tone.body, height: 1.55)),
                        ],
                        const SizedBox(height: 20),
                        _explainerSection(context),
                        if (concept.learningObjectives.isNotEmpty) ...[
                          const SizedBox(height: 20),
                          const SectionLabel('You should be able to'),
                          for (final o in concept.learningObjectives) _Bullet(o),
                        ],
                        const SizedBox(height: 24),
                        const SectionLabel('Ask the tutor'),
                        if (_chat.isEmpty)
                          Text('Ask anything about this concept. The tutor knows what you have already got wrong.', style: TextStyle(fontSize: 13, color: tone.muted, height: 1.5)),
                        for (final m in _chat) _Bubble(message: m),
                        if (_asking)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 10),
                            child: Row(children: [
                              const SizedBox(height: 12, width: 12, child: CircularProgressIndicator(strokeWidth: 2)),
                              const SizedBox(width: 10),
                              Text('Your desktop is writing an answer…', style: TextStyle(fontSize: 12, color: tone.muted)),
                            ]),
                          ),
                      ],
                    ),
                  ),
                  _composer(context),
                ]),
    );
  }

  Widget _explainerSection(BuildContext context) {
    final tone = LearnTone.of(context);
    if (_explainerLoading) {
      return LearnPanel(
        child: Row(children: [
          const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: 12),
          Expanded(child: Text('Loading the explanation…', style: TextStyle(fontSize: 13, color: tone.muted))),
        ]),
      );
    }
    final explainer = _explainer;
    if (explainer == null || !explainer.available) {
      final offline = isDesktopOfflineError(_explainerError);
      final text = _explainerError != null ? learnErrorMessage(_explainerError) : (explainer?.unavailableReason ?? 'The explanation has not been written yet.');
      return LearnPanel(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(offline ? Icons.desktop_access_disabled_outlined : Icons.info_outline, size: 18, color: tone.muted),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: TextStyle(fontSize: 13, color: tone.body, height: 1.5))),
          TextButton(onPressed: () {
            setState(() => _explainerLoading = true);
            _loadExplainer();
          }, child: const Text('Retry')),
        ]),
      );
    }
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      Text(explainer.summary, style: TextStyle(fontSize: 15, color: tone.strong, height: 1.6)),
      if (explainer.realWorld.isNotEmpty) ...[
        const SizedBox(height: 16),
        const SectionLabel('In real work'),
        Text(explainer.realWorld, style: TextStyle(fontSize: 14, color: tone.body, height: 1.6)),
      ],
      if (explainer.examples.isNotEmpty) ...[
        const SizedBox(height: 16),
        const SectionLabel('Examples'),
        for (final e in explainer.examples) _Bullet(e),
      ],
      if (explainer.codeExample != null && explainer.codeExample!.trim().isNotEmpty) ...[
        const SizedBox(height: 16),
        SectionLabel(explainer.codeLanguage == null ? 'Code' : 'Code · ${explainer.codeLanguage}'),
        _CodeBlock(code: explainer.codeExample!),
      ],
      if (explainer.pitfalls.isNotEmpty) ...[
        const SizedBox(height: 16),
        const SectionLabel('Pitfalls'),
        for (final p in explainer.pitfalls) _Bullet(p),
      ],
    ]);
  }

  Widget _composer(BuildContext context) {
    final tone = LearnTone.of(context);
    return Container(
      padding: EdgeInsets.fromLTRB(16, 10, 8, MediaQuery.of(context).padding.bottom + 10),
      decoration: BoxDecoration(color: tone.card, border: Border(top: BorderSide(color: tone.line))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        if (_askError != null)
          Padding(
            padding: const EdgeInsets.only(bottom: 8, right: 8),
            child: Text(_askError!, style: TextStyle(color: tone.fail, fontSize: 12)),
          ),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _question,
              minLines: 1,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Ask about this concept'),
              onSubmitted: (_) => _ask(),
            ),
          ),
          IconButton(onPressed: _asking ? null : _ask, icon: const Icon(Icons.send), tooltip: 'Ask'),
        ]),
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
      padding: const EdgeInsets.only(bottom: 6),
      child: Text('· $text', style: TextStyle(fontSize: 14, color: LearnTone.of(context).body, height: 1.5)),
    );
  }
}

class _CodeBlock extends StatelessWidget {
  const _CodeBlock({required this.code});

  final String code;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return Stack(children: [
      Container(
        width: double.infinity,
        padding: const EdgeInsets.fromLTRB(12, 12, 40, 12),
        decoration: BoxDecoration(color: tone.raised, border: Border.all(color: tone.line), borderRadius: BorderRadius.circular(10)),
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: SelectableText(code, style: TextStyle(fontFamily: 'monospace', fontSize: 12.5, color: tone.strong, height: 1.45)),
        ),
      ),
      Positioned(
        right: 0,
        top: 0,
        child: IconButton(
          icon: const Icon(Icons.copy, size: 16),
          tooltip: 'Copy code',
          onPressed: () => Clipboard.setData(ClipboardData(text: code)),
        ),
      ),
    ]);
  }
}

class _Bubble extends StatelessWidget {
  const _Bubble({required this.message});

  final ChatMessage message;

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    final scheme = Theme.of(context).colorScheme;
    final mine = message.fromUser;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.85),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: mine ? scheme.primaryContainer : tone.card,
          border: mine ? null : Border.all(color: tone.line),
          borderRadius: BorderRadius.circular(14),
        ),
        child: SelectableText(message.content, style: TextStyle(fontSize: 14, color: mine ? scheme.onPrimaryContainer : tone.strong, height: 1.5)),
      ),
    );
  }
}
