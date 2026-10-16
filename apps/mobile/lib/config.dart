/// The Offerpath server this build talks to, fixed at build time (the server
/// root; the API lives under `/api/v1`):
///
///   flutter build apk --release --dart-define=OFFERPATH_SERVER_URL=http://1.2.3.4:50005
///
/// CI sets it from the root `.env`'s `OFFERPATH_SERVER_URL`. When it's set,
/// the app has no server field at all. A local `flutter run` without it asks
/// for one on the sign-in screen, which is handy for development only.
const String kBuiltInServerUrl = String.fromEnvironment('OFFERPATH_SERVER_URL');

bool get hasBuiltInServer => kBuiltInServerUrl.trim().isNotEmpty;

/// Every REST path and the hub live under this prefix on the server.
const String kApiPrefix = '/api/v1';

/// `http://host:50005/` or ` http://host:50005 ` → `http://host:50005`.
String normalizeServerUrl(String input) {
  var trimmed = input.trim();
  while (trimmed.endsWith('/')) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  return trimmed;
}

/// The REST base for a server root: `http://host:50005/api/v1`.
String apiBaseUrl(String serverUrl) => '${normalizeServerUrl(serverUrl)}$kApiPrefix';

/// The hub WebSocket for a server root and device token.
Uri hubUri(String serverUrl, String deviceToken) {
  final root = normalizeServerUrl(serverUrl);
  final scheme = root.startsWith('https://') ? 'wss' : 'ws';
  final rest = root.replaceFirst(RegExp(r'^https?://'), '');
  return Uri.parse('$scheme://$rest$kApiPrefix/hub?token=${Uri.encodeQueryComponent(deviceToken)}');
}
