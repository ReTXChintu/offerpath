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
  int recallDue = 0;
  bool loading = false;
  bool loadedOnce = false;
  String? error;

  void _onAuth() {
    if (auth.status != AuthStatus.signedIn && (routine != null || loadedOnce)) {
      routine = null;
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
      final json = await api.get('/routines/today');
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

  @override
  void dispose() {
    auth.removeListener(_onAuth);
    super.dispose();
  }
}
