import 'dart:io';

import 'package:flutter/foundation.dart';

import '../config.dart';
import '../services/api_client.dart';
import '../services/push_service.dart';
import '../services/secure_store.dart';

enum AuthStatus { unknown, signedOut, signedIn }

/// Builds the API client for a server and token; replaced in tests.
typedef ApiFactory = ApiClient Function(String serverUrl, {String? token});

ApiClient _defaultApi(String serverUrl, {String? token}) => ApiClient(serverUrl, token: token);

/// Owns sign-in, pairing and sign-out. Holds no hunt or learning data.
/// After the one sign-in-or-pair call, only the device token is kept: the
/// API accepts it everywhere a JWT works, so the password, access token and
/// refresh token are never stored.
class AuthController extends ChangeNotifier {
  final LocalStore _store;
  final ApiFactory _apiFactory;
  AuthController({LocalStore? store, ApiFactory? apiFactory})
      : _store = store ?? LocalStore(),
        _apiFactory = apiFactory ?? _defaultApi;

  AuthStatus status = AuthStatus.unknown;
  bool isBusy = false;
  String? lastError;

  String? serverUrl;
  String? accountEmail;
  String? deviceName;
  String? deviceId;
  String? deviceToken;

  ApiClient? _api;

  /// The API with this phone's device token; null while signed out.
  ApiClient? get api => _api;

  Future<void> loadPersisted() async {
    final token = await _store.deviceToken;
    serverUrl = await _store.serverUrl;
    // The server address is fixed per build: if this phone signed in under
    // an older build's address, follow the current one.
    if (hasBuiltInServer && serverUrl != null && serverUrl!.isNotEmpty) {
      serverUrl = normalizeServerUrl(kBuiltInServerUrl);
    }
    accountEmail = await _store.accountEmail;
    deviceName = await _store.deviceName;
    deviceId = await _store.deviceId;
    deviceToken = token;
    final signedIn = token != null && token.isNotEmpty && serverUrl != null && serverUrl!.isNotEmpty;
    _api = signedIn ? _apiFactory(serverUrl!, token: token) : null;
    status = signedIn ? AuthStatus.signedIn : AuthStatus.signedOut;
    notifyListeners();
  }

  Future<bool> _run(Future<void> Function() body) async {
    isBusy = true;
    lastError = null;
    notifyListeners();
    try {
      await body();
      isBusy = false;
      notifyListeners();
      return true;
    } catch (e) {
      isBusy = false;
      lastError = e is ApiException ? e.message : e.toString();
      notifyListeners();
      return false;
    }
  }

  /// Creates an account, then registers this phone on it.
  Future<bool> signUp({required String serverUrl, required String displayName, required String email, required String password, required String deviceName}) =>
      _authenticate(serverUrl: serverUrl, email: email, password: password, deviceName: deviceName, displayName: displayName);

  /// Signs in with email and password, then registers this phone.
  Future<bool> signIn({required String serverUrl, required String email, required String password, required String deviceName}) =>
      _authenticate(serverUrl: serverUrl, email: email, password: password, deviceName: deviceName);

  Future<bool> _authenticate({required String serverUrl, required String email, required String password, required String deviceName, String? displayName}) {
    return _run(() async {
      final url = normalizeServerUrl(serverUrl);
      final api = _apiFactory(url);
      final name = _nameOrDefault(deviceName);
      final tokens = displayName == null ? await api.login(email.trim(), password) : await api.register(email.trim(), password, displayName.trim());
      final device = await api.registerDevice(accessToken: tokens.accessToken, name: name, platform: _platform());
      await _signedIn(url, device, email: email.trim(), name: name);
    });
  }

  /// Pairs with a one-time code from the desktop (scanned or typed): no
  /// password on the phone at all.
  Future<bool> pairWithCode({required String serverUrl, required String code, required String deviceName}) {
    return _run(() async {
      final url = normalizeServerUrl(serverUrl);
      final name = _nameOrDefault(deviceName);
      final device = await _apiFactory(url).redeemPairingCode(code: code.trim().toUpperCase(), name: name, platform: _platform());
      await _signedIn(url, device, email: '', name: name);
    });
  }

  Future<void> _signedIn(String url, DeviceRegistration device, {required String email, required String name}) async {
    await _store.setDeviceToken(device.deviceToken);
    await _store.saveDevice(serverUrl: url, accountEmail: email, deviceName: name, deviceId: device.deviceId);
    serverUrl = url;
    accountEmail = email;
    deviceName = name;
    deviceId = device.deviceId;
    deviceToken = device.deviceToken;
    _api = _apiFactory(url, token: device.deviceToken);
    status = AuthStatus.signedIn;
  }

  /// Signs this phone out: stops pushes, signs the device out on the server
  /// (best effort: offline, it still forgets the token here) and forgets it.
  Future<void> signOut() async {
    isBusy = true;
    notifyListeners();
    // Both authenticate with the device token, so they go first.
    await PushService.instance.unregister(_api);
    final api = _api, id = deviceId;
    if (api != null && id != null && id.isNotEmpty) {
      try {
        await api.revokeDevice(id);
      } catch (e) {
        debugPrint('could not sign this device out on the server: $e');
      }
    }
    await _forget();
  }

  /// The server refused this phone's token (revoked from the desktop or the
  /// web): forget it locally, nothing to tell the server.
  Future<void> handleRevoked() async {
    if (status != AuthStatus.signedIn) return;
    await PushService.instance.unregister(null);
    lastError = 'This phone was signed out from another device. Pair or sign in again.';
    await _forget(keepError: true);
  }

  Future<void> _forget({bool keepError = false}) async {
    await _store.clearAll();
    serverUrl = null;
    accountEmail = null;
    deviceName = null;
    deviceId = null;
    deviceToken = null;
    _api = null;
    if (!keepError) lastError = null;
    status = AuthStatus.signedOut;
    isBusy = false;
    notifyListeners();
  }

  String _nameOrDefault(String name) => name.trim().isEmpty ? _defaultDeviceName() : name.trim();

  String _platform() {
    if (kIsWeb) return 'web';
    if (Platform.isAndroid) return 'android';
    if (Platform.isIOS) return 'ios';
    return Platform.operatingSystem;
  }

  String _defaultDeviceName() => '${_platform()} phone';
}
