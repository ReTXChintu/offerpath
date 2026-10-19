import 'dart:async';

import 'package:flutter/foundation.dart';

import '../models/interview_prep.dart';
import 'auth_controller.dart';
import 'connection_controller.dart';

/// The interviews being prepared for, shared by Learn > Interview prep and
/// the Today card. Reloads when the server says they changed (the hub's
/// `changed` frame for `interview_preps`, sent when a prep is ready or has
/// failed), when the connection comes back, and on sign-in.
class InterviewPrepController extends ChangeNotifier {
  static const collection = 'interview_preps';

  final AuthController auth;
  final ConnectionController? connection;
  StreamSubscription? _changedSub;
  StreamSubscription? _resyncSub;
  bool _signedIn = false;

  InterviewPrepController(this.auth, [this.connection]) {
    _changedSub = connection?.changed.listen((update) {
      if (update.collections.contains(collection)) {
        _changes.add(null);
        refresh();
      }
    });
    _resyncSub = connection?.resync.listen((_) {
      if (_signedIn) refresh();
    });
    auth.addListener(_onAuth);
    _onAuth();
  }

  List<Prep> items = const [];
  bool loading = false;
  bool loadedOnce = false;
  String? error;

  final _changes = StreamController<void>.broadcast();

  /// Fires when the server says preps changed: an open prep screen reloads.
  Stream<void> get changes => _changes.stream;

  /// Today's card: interviews in the next two weeks.
  List<Prep> get upcoming => upcomingPreps(items);

  void _onAuth() {
    final signedIn = auth.status == AuthStatus.signedIn && auth.api != null;
    if (signedIn && !_signedIn) {
      _signedIn = true;
      refresh();
    } else if (!signedIn && _signedIn) {
      _signedIn = false;
      items = const [];
      loadedOnce = false;
      error = null;
      notifyListeners();
    }
  }

  Future<void> refresh() async {
    final api = auth.api;
    if (api == null || loading) return;
    loading = true;
    notifyListeners();
    try {
      items = await api.listPreps();
      error = null;
    } catch (e) {
      error = prepErrorMessage(e);
    } finally {
      loading = false;
      loadedOnce = true;
      notifyListeners();
    }
  }

  /// A prep screen saw a newer copy (created, edited, answered): show it
  /// in the list without another round trip.
  void put(Prep prep) {
    final i = items.indexWhere((p) => p.id == prep.id);
    final next = [...items];
    if (i < 0) {
      next.add(prep);
    } else {
      next[i] = prep;
    }
    next.sort((a, b) => a.scheduledAt.compareTo(b.scheduledAt));
    items = next;
    notifyListeners();
  }

  void removeLocal(String id) {
    items = items.where((p) => p.id != id).toList();
    notifyListeners();
  }

  @override
  void dispose() {
    _changedSub?.cancel();
    _resyncSub?.cancel();
    _changes.close();
    auth.removeListener(_onAuth);
    super.dispose();
  }
}
