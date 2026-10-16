import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../logic/links.dart';
import '../state/jobs_controller.dart';
import '../state/nav_controller.dart';
import 'applications_list_screen.dart';
import 'jobs_screen.dart';

/// The Hunt tab: applications (approve, reject, answer questions, record
/// interview calls) and the jobs the desktop found (filters, location).
/// Everything here runs on the desktop, through its own approval-gated code.
class HuntScreen extends StatefulWidget {
  const HuntScreen({super.key});

  @override
  State<HuntScreen> createState() => _HuntScreenState();
}

class _HuntScreenState extends State<HuntScreen> with SingleTickerProviderStateMixin {
  late final NavController _nav = context.read<NavController>();
  late final TabController _tabs = TabController(length: 2, vsync: this, initialIndex: _nav.huntPage);

  @override
  void initState() {
    super.initState();
    _nav.addListener(_onNav);
    _tabs.addListener(_onTab);
  }

  void _onNav() {
    if (_tabs.index != _nav.huntPage) _tabs.animateTo(_nav.huntPage);
  }

  void _onTab() {
    if (_tabs.indexIsChanging) return;
    _nav.selectHuntPage(_tabs.index);
    if (_tabs.index == huntJobs) context.read<JobsController>().ensureLoaded();
  }

  @override
  void dispose() {
    _nav.removeListener(_onNav);
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Hunt'),
        bottom: TabBar(controller: _tabs, tabs: const [Tab(text: 'Applications'), Tab(text: 'Jobs')]),
      ),
      body: TabBarView(
        controller: _tabs,
        children: const [ApplicationsListScreen(embedded: true), JobsScreen(embedded: true)],
      ),
    );
  }
}
