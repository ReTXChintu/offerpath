import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

import '../logic/links.dart';
import '../models/app_notification.dart';
import 'api_client.dart';
import 'link_bus.dart';
import 'notification_service.dart';

/// Firebase delivered a push while the app was in the background or closed.
/// Android already showed it (it carries a `notification` block); only move
/// the shared watermark so the periodic check doesn't show it a second time.
@pragma('vm:entry-point')
Future<void> firebaseBackgroundHandler(RemoteMessage message) async {
  try {
    await NotificationService.instance.markAlerted(message.data['createdAt']?.toString() ?? '');
  } catch (e) {
    debugPrint('background push bookkeeping failed: $e');
  }
}

AppNotification notificationFromMessage(RemoteMessage m) => AppNotification.fromPushData(m.data, title: m.notification?.title, body: m.notification?.body);

/// Instant notifications through Firebase Cloud Messaging, even with the app
/// closed. Entirely optional: without `google-services.json` in the build,
/// [init] fails quietly, [available] stays false, and the app relies on the
/// WebSocket (while open) and the WorkManager check (while closed).
class PushService {
  PushService._();
  static final instance = PushService._();

  bool available = false;
  final _foreground = StreamController<AppNotification>.broadcast();
  StreamSubscription<String>? _refreshSub;
  ApiClient? _api;

  /// Pushes that arrive while the app is open (Android doesn't show those
  /// itself); shown through the same local path as WebSocket pushes.
  Stream<AppNotification> get foreground => _foreground.stream;

  Future<void> init() async {
    try {
      await Firebase.initializeApp();
    } catch (e) {
      debugPrint('Firebase is not configured ($e); using periodic notification checks only.');
      return;
    }
    available = true;
    FirebaseMessaging.onBackgroundMessage(firebaseBackgroundHandler);
    FirebaseMessaging.onMessage.listen((m) => _foreground.add(notificationFromMessage(m)));
    FirebaseMessaging.onMessageOpenedApp.listen((m) => LinkBus.instance.open(linkFromPushData(m.data)));
    try {
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) LinkBus.instance.open(linkFromPushData(initial.data));
    } catch (e) {
      debugPrint('could not read the launching push: $e');
    }
  }

  /// Signed in (or started signed in): tell the server where to push.
  Future<void> register(ApiClient api) async {
    _api = api;
    if (!available) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await api.setPushToken(token);
      _refreshSub ??= FirebaseMessaging.instance.onTokenRefresh.listen((t) {
        _api?.setPushToken(t).catchError((Object e) => debugPrint('push token refresh failed: $e'));
      });
    } catch (e) {
      debugPrint('push registration failed: $e');
    }
  }

  /// Signing out: stop pushes to this phone. Called before the credentials
  /// are cleared, since it authenticates with them ([api] is null when the
  /// token was already refused).
  Future<void> unregister(ApiClient? api) async {
    _api = null;
    await _refreshSub?.cancel();
    _refreshSub = null;
    if (api == null || !available) return;
    try {
      await api.setPushToken(null);
    } catch (e) {
      debugPrint('could not clear the push token: $e');
    }
  }
}
