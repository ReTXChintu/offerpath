import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Everything this phone remembers about its sign-in, split the same way
/// the desktop splits it: the device token is the one secret (Android
/// Keystore via flutter_secure_storage); the server address and display
/// details are not secret and live in shared_preferences.
class LocalStore {
  static const _deviceTokenKey = 'offerpath.device_token';
  static const _deviceIdKey = 'offerpath.device_id';
  static const _serverUrlKey = 'offerpath.server_url';
  static const _accountEmailKey = 'offerpath.account_email';
  static const _deviceNameKey = 'offerpath.device_name';

  final FlutterSecureStorage _secure;
  LocalStore({FlutterSecureStorage? secure}) : _secure = secure ?? const FlutterSecureStorage();

  Future<String?> get deviceToken => _secure.read(key: _deviceTokenKey);
  Future<void> setDeviceToken(String token) => _secure.write(key: _deviceTokenKey, value: token);
  Future<void> clearDeviceToken() => _secure.delete(key: _deviceTokenKey);

  Future<void> saveDevice({required String serverUrl, required String accountEmail, required String deviceName, required String deviceId}) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_serverUrlKey, serverUrl);
    await prefs.setString(_accountEmailKey, accountEmail);
    await prefs.setString(_deviceNameKey, deviceName);
    await prefs.setString(_deviceIdKey, deviceId);
  }

  Future<String?> get serverUrl async => (await SharedPreferences.getInstance()).getString(_serverUrlKey);
  Future<String?> get accountEmail async => (await SharedPreferences.getInstance()).getString(_accountEmailKey);
  Future<String?> get deviceName async => (await SharedPreferences.getInstance()).getString(_deviceNameKey);
  Future<String?> get deviceId async => (await SharedPreferences.getInstance()).getString(_deviceIdKey);

  Future<void> clearAll() async {
    await clearDeviceToken();
    final prefs = await SharedPreferences.getInstance();
    for (final key in [_serverUrlKey, _accountEmailKey, _deviceNameKey, _deviceIdKey]) {
      await prefs.remove(key);
    }
  }
}
