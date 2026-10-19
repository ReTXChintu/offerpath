import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/interview_prep.dart';
import '../services/api_client.dart';
import '../state/interview_prep_controller.dart';
import 'prep_create_page.dart';
import 'prep_detail_page.dart';
import 'prep_widgets.dart';
import 'ui.dart';

/// Learn > Interview prep: the real interviews being prepared for (soonest
/// first, past ones after), and "Prepare for an interview".
class PrepListPage extends StatefulWidget {
  const PrepListPage({required this.api, super.key});

  final ApiClient api;

  @override
  State<PrepListPage> createState() => _PrepListPageState();
}

class _PrepListPageState extends State<PrepListPage> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final preps = context.read<InterviewPrepController>();
      if (!preps.loadedOnce) preps.refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final preps = context.watch<InterviewPrepController>();
    final tone = LearnTone.of(context);
    final now = DateTime.now();
    final cutoff = now.subtract(const Duration(hours: 3));
    final coming = preps.items.where((p) => !p.scheduledAt.isBefore(cutoff)).toList()..sort((a, b) => a.scheduledAt.compareTo(b.scheduledAt));
    final past = preps.items.where((p) => p.scheduledAt.isBefore(cutoff)).toList()..sort((a, b) => b.scheduledAt.compareTo(a.scheduledAt));

    if (preps.items.isEmpty && preps.loading) return const Center(child: CircularProgressIndicator());

    Widget tile(Prep p) => Padding(padding: const EdgeInsets.only(bottom: 10), child: PrepTile(prep: p, onTap: () => openPrep(context, p.id)));

    return RefreshIndicator(
      onRefresh: preps.refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 40),
        children: [
          FilledButton.icon(
            onPressed: () => openPrepCreate(context, widget.api, preps: preps),
            icon: const Icon(Icons.add),
            label: const Text('Prepare for an interview'),
          ),
          if (preps.error != null && preps.items.isEmpty) ...[
            const SizedBox(height: 24),
            Text(preps.error!, style: TextStyle(color: tone.fail, height: 1.5)),
          ] else if (preps.items.isEmpty) ...[
            const SizedBox(height: 24),
            LearnPanel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('No interviews yet', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: tone.strong)),
                const SizedBox(height: 6),
                Text(
                  'Got an interview coming up? Paste the job description or list the technologies, and AI writes a plan up to the day and the questions you are likely to get. Practise them here, typed or spoken.',
                  style: TextStyle(fontSize: 13, color: tone.muted, height: 1.5),
                ),
              ]),
            ),
          ],
          if (coming.isNotEmpty) ...[
            const SizedBox(height: 24),
            const SectionLabel('Coming up'),
            for (final p in coming) tile(p),
          ],
          if (past.isNotEmpty) ...[
            const SizedBox(height: 16),
            const SectionLabel('Past'),
            for (final p in past) tile(p),
          ],
        ],
      ),
    );
  }
}
