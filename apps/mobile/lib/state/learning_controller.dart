import 'package:flutter/foundation.dart';

import '../learn/models.dart';
import '../learn/ui.dart';
import 'auth_controller.dart';

/// Today's learning at a glance, for the Today tab: the routine (if one is
/// planned) and how many reviews are due. Learn > Routine has the full page.
class LearningController extends ChangeNotifier {
  final AuthController auth;
  LearningController(this.auth) {
    auth.addListener(_onAuth);
  }

  Routine? routine;
  /// The rest of the day's plan (goal, streak, interview prep), when the server has it.
  TodayPlan? plan;
  bool starting = false;
  int recallDue = 0;
  bool loading = false;
  bool loadedOnce = false;
  String? error;

  void _onAuth() {
    if (auth.status != AuthStatus.signedIn && (routine != null || loadedOnce)) {
      routine = null;
      plan = null;
      recallDue = 0;
      loadedOnce = false;
      error = null;
      notifyListeners();
    }
  }

  /// The next unfinished item, if any.
  RoutineItem? get nextItem => routine?.items.where((i) => !i.isDone && !i.isSkipped).firstOrNull;

  Future<void> refresh() async {
    final api = auth.api;
    if (api == null || loading) return;
    loading = true;
    notifyListeners();
    try {
      // The daily plan carries today's routine with the goal and the streak.
      final today = await api.get('/today');
      final map = today is Map ? today.cast<String, dynamic>() : const <String, dynamic>{};
      plan = map.isEmpty ? null : TodayPlan.fromJson(map);
      final json = map['learning'];
      routine = json is Map && json.isNotEmpty ? Routine.fromJson(json.cast<String, dynamic>()) : null;
      if (routine != null) {
        recallDue = routine!.recallDue;
      } else {
        final due = await api.get('/recall/due');
        recallDue = due is List ? due.length : 0;
      }
      error = null;
    } catch (e) {
      error = learnErrorMessage(e);
    } finally {
      loading = false;
      loadedOnce = true;
      notifyListeners();
    }
  }

  /// "Start my day".
  Future<void> startDay() async {
    final api = auth.api;
    if (api == null || starting) return;
    starting = true;
    notifyListeners();
    try {
      final map = await api.post('/today/start');
      if (map is Map) plan = TodayPlan.fromJson(map.cast<String, dynamic>());
      error = null;
    } catch (e) {
      error = learnErrorMessage(e);
    } finally {
      starting = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    auth.removeListener(_onAuth);
    super.dispose();
  }
}
