import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../logic/filters.dart';
import '../learn/learn_screen.dart';
import '../learn/prep_detail_page.dart';
import '../logic/links.dart';
import '../services/link_bus.dart';
import '../state/applications_controller.dart';
import '../state/nav_controller.dart';
import '../state/notifications_controller.dart';
import 'about_screen.dart';
import 'application_detail_screen.dart';
import 'home_screen.dart';
import 'job_sites_screen.dart';
import 'hunt_screen.dart';
import 'more_screen.dart';
import 'notifications_screen.dart';

/// Opens the screen a notification links to: switches tab, then pushes a
/// detail screen when the link names one.
void openAppLink(BuildContext context, AppLink link) {
  final nav = context.read<NavController>();
  switch (link.kind) {
    case LinkKind.application:
      nav.openApplications();
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => ApplicationDetailScreen(applicationId: link.id!)));
    case LinkKind.applications:
      nav.openApplications();
    case LinkKind.jobs:
      nav.openJobs();
    case LinkKind.jobSites:
      nav.select(tabMore);
      Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const JobSitesScreen()));
    case LinkKind.interviewPrep:
      nav.openLearn(learnPrep);
      openPrep(context, link.id!);
    case LinkKind.interviewPreps:
      nav.openLearn(learnPrep);
    case LinkKind.home:
      nav.select(tabToday);
  }
}

/// The signed-in shell (plan section 5.4): Today, Learn, Hunt, Alerts, More.
class AppShell extends StatelessWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context) => const AppLinkListener(child: _Shell());
}

/// Opens the screens notification taps link to ([LinkBus]): the ones tapped
/// while [child] is up, and the one that launched the app (a cold start),
/// taken once the first frame is drawn.
class AppLinkListener extends StatefulWidget {
  const AppLinkListener({required this.child, super.key});

  final Widget child;

  @override
  State<AppLinkListener> createState() => _AppLinkListenerState();
}

class _AppLinkListenerState extends State<AppLinkListener> {
  StreamSubscription<AppLink>? _linkSub;

  @override
  void initState() {
    super.initState();
    // Notification taps: now, and any that launched the app before this existed.
    _linkSub = LinkBus.instance.links.listen((_) => _takeLink());
    WidgetsBinding.instance.addPostFrameCallback((_) => _takeLink());
  }

  void _takeLink() {
    if (!mounted) return;
    final link = LinkBus.instance.take();
    if (link == null) return;
    // Close any detail screen first so the link opens from the shell.
    Navigator.of(context).popUntil((route) => route.isFirst);
    openAppLink(context, link);
  }

  @override
  void dispose() {
    _linkSub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

class _Shell extends StatelessWidget {
  const _Shell();

  @override
  Widget build(BuildContext context) {
    final nav = context.watch<NavController>();
    final unread = context.watch<NotificationsController>().unread;
    final counts = bucketCounts(context.watch<ApplicationsController>().items);
    final waiting = counts[ApplicationBucket.needsYou]! + counts[ApplicationBucket.pendingApproval]!;

    Widget badged(IconData icon, int count) => Badge(isLabelVisible: count > 0, label: Text(count > 99 ? '99+' : '$count'), child: Icon(icon));

    return Scaffold(
      body: Column(
        children: [
          const UpdateBanner(),
          Expanded(
            child: IndexedStack(
              index: nav.tab,
              children: const [HomeScreen(), LearnScreen(), HuntScreen(), NotificationsScreen(), MoreScreen()],
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: nav.tab,
        onDestinationSelected: (i) {
          // Leaving the Alerts tab counts as having seen them.
          if (nav.tab == tabAlerts && i != tabAlerts) context.read<NotificationsController>().markAllSeen();
          nav.select(i);
        },
        destinations: [
          const NavigationDestination(icon: Icon(Icons.today_outlined), selectedIcon: Icon(Icons.today), label: 'Today'),
          const NavigationDestination(icon: Icon(Icons.school_outlined), selectedIcon: Icon(Icons.school), label: 'Learn'),
          NavigationDestination(icon: badged(Icons.work_outline, waiting), selectedIcon: badged(Icons.work, waiting), label: 'Hunt'),
          NavigationDestination(icon: badged(Icons.notifications_outlined, unread), selectedIcon: badged(Icons.notifications, unread), label: 'Alerts'),
          const NavigationDestination(icon: Icon(Icons.more_horiz), selectedIcon: Icon(Icons.more_horiz), label: 'More'),
        ],
      ),
    );
  }
}
