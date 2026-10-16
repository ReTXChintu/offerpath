import 'package:flutter/foundation.dart';

import '../logic/filters.dart';
import '../logic/links.dart';

/// The signed-in shell's selected tab (and the page inside Hunt and Learn),
/// plus one-shot requests for a page to open with a particular filter (e.g.
/// Today's "Pending approval" count opens Applications filtered to it).
class NavController extends ChangeNotifier {
  int tab = tabToday;
  int huntPage = huntApplications;
  int learnPage = learnRoutine;
  ApplicationBucket? requestedBucket;
  JobFilter? requestedJobFilter;

  void select(int index) {
    if (tab == index) return;
    tab = index;
    notifyListeners();
  }

  void selectHuntPage(int page) {
    if (huntPage == page) return;
    huntPage = page;
    notifyListeners();
  }

  void openLearn([int page = learnRoutine]) {
    learnPage = page;
    tab = tabLearn;
    notifyListeners();
  }

  void openApplications([ApplicationBucket? bucket]) {
    requestedBucket = bucket;
    tab = tabHunt;
    huntPage = huntApplications;
    notifyListeners();
  }

  void openJobs([JobFilter? filter]) {
    requestedJobFilter = filter;
    tab = tabHunt;
    huntPage = huntJobs;
    notifyListeners();
  }

  ApplicationBucket? takeBucket() {
    final b = requestedBucket;
    requestedBucket = null;
    return b;
  }

  JobFilter? takeJobFilter() {
    final f = requestedJobFilter;
    requestedJobFilter = null;
    return f;
  }
}
