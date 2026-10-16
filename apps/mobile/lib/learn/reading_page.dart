import 'package:flutter/material.dart';

import '../services/api_client.dart';
import 'concept_page.dart';
import 'models.dart';
import 'ui.dart';

/// Learn > Read: the concepts on the roadmap, in order, with "you are here"
/// marked. Opening one shows its explanation and the tutor.
class ReadingPage extends StatefulWidget {
  const ReadingPage({required this.api, super.key});

  final ApiClient api;

  @override
  State<ReadingPage> createState() => _ReadingPageState();
}

class _ReadingPageState extends State<ReadingPage> {
  late Future<List<ReadingItem>> _items = _load();

  Future<List<ReadingItem>> _load() async => readingListFromRoadmap(await widget.api.get('/roadmap'));

  Future<void> _refresh() async {
    setState(() => _items = _load());
    try {
      await _items;
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final tone = LearnTone.of(context);
    return RefreshIndicator(
      onRefresh: _refresh,
      child: FutureBuilder<List<ReadingItem>>(
        future: _items,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snapshot.hasError) return LearnErrorView(title: 'Could not load your roadmap', error: snapshot.error, onRetry: _refresh);
          final items = snapshot.data ?? const [];
          if (items.isEmpty) {
            return const LearnMessage(
              icon: Icons.map_outlined,
              title: 'No roadmap yet',
              body: 'Set your goal and technologies on your desktop or the web first. That is a sit-down decision, not a phone one.',
            );
          }
          String? lastPhase;
          final children = <Widget>[];
          for (final item in items) {
            if (item.phase != lastPhase) {
              lastPhase = item.phase;
              children.add(Padding(padding: const EdgeInsets.only(top: 12), child: SectionLabel(item.phase)));
            }
            children.add(Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: Icon(
                  item.isDone ? Icons.check_circle : (item.isCurrent ? Icons.radio_button_checked : Icons.menu_book_outlined),
                  color: item.isDone ? LearnTone.pass : (item.isCurrent ? tone.accent : tone.muted),
                ),
                title: Text(item.title, style: TextStyle(fontWeight: item.isCurrent ? FontWeight.w700 : FontWeight.w500)),
                subtitle: Text([if (item.isCurrent) 'You are here', if (item.minutes > 0) '${item.minutes} min'].join(' · ')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ConceptPage(api: widget.api, conceptId: item.conceptId, title: item.title))),
              ),
            ));
          }
          return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.fromLTRB(16, 4, 16, 32), children: children);
        },
      ),
    );
  }
}
