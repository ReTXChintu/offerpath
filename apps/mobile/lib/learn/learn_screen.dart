import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../logic/links.dart';
import '../state/auth_controller.dart';
import '../state/nav_controller.dart';
import 'interview_page.dart';
import 'live/live_practice_list_page.dart';
import 'prep_list_page.dart';
import 'reading_page.dart';
import 'recall.dart';
import 'routine_page.dart';

/// The Learn tab: today's routine, recall flashcards, spoken mock
/// interviews, interview prep for real interviews, reading (with the
/// tutor), and live practice with a partner. Ported from ForgeRoutine's app;
/// writing code is absent on purpose, since it needs a keyboard and an
/// editor, so coding items point to the desktop and the web.
class LearnScreen extends StatefulWidget {
  const LearnScreen({super.key});

  @override
  State<LearnScreen> createState() => _LearnScreenState();
}

class _LearnScreenState extends State<LearnScreen> with SingleTickerProviderStateMixin {
  late final NavController _nav = context.read<NavController>();
  late final TabController _tabs = TabController(length: 6, vsync: this, initialIndex: _nav.learnPage);

  @override
  void initState() {
    super.initState();
    _nav.addListener(_onNav);
    _tabs.addListener(() {
      if (!_tabs.indexIsChanging) _nav.learnPage = _tabs.index;
    });
  }

  void _onNav() {
    if (_tabs.index != _nav.learnPage) _tabs.animateTo(_nav.learnPage);
  }

  @override
  void dispose() {
    _nav.removeListener(_onNav);
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final api = context.select<AuthController, Object?>((a) => a.api);
    return Scaffold(
      appBar: AppBar(
        title: const Text('Learn'),
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          tabs: const [Tab(text: 'Routine'), Tab(text: 'Recall'), Tab(text: 'Interviews'), Tab(text: 'Interview prep'), Tab(text: 'Read'), Tab(text: 'Live practice')],
        ),
      ),
      body: api == null
          ? const SizedBox.shrink()
          : Builder(builder: (context) {
              final client = context.read<AuthController>().api!;
              return TabBarView(
                controller: _tabs,
                children: [
                  RoutinePage(api: client, onOpenInterviews: () => _nav.openLearn(learnInterviews)),
                  RecallPage(api: client),
                  InterviewPage(api: client),
                  PrepListPage(api: client),
                  ReadingPage(api: client),
                  LivePracticeListPage(api: client),
                ],
              );
            }),
    );
  }
}
