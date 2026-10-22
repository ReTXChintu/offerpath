import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../models/live_practice.dart';
import '../../services/api_client.dart';
import 'realtime_client.dart';
import 'speaker_embedder.dart';
import 'speaker_model_store.dart';

/// A copy of the user's voiceprint on the phone (for when the server can't
/// be reached), and whether the voice setup has been offered already.
abstract interface class VoiceCache {
  Future<VoiceProfile?> read();
  Future<void> write(VoiceProfile? profile);
  Future<bool> setupOffered();
  Future<void> markSetupOffered();
}

/// [VoiceCache] in shared preferences, one per account ([scope]).
class PrefsVoiceCache implements VoiceCache {
  PrefsVoiceCache(String scope)
    : _profileKey = 'offerpath.live.voice.$scope',
      _offeredKey = 'offerpath.live.voice_offered.$scope';

  final String _profileKey;
  final String _offeredKey;

  @override
  Future<VoiceProfile?> read() async {
    final raw = (await SharedPreferences.getInstance()).getString(_profileKey);
    if (raw == null) return null;
    final decoded = jsonDecode(raw);
    return decoded is Map
        ? VoiceProfile.fromJson(decoded.cast<String, dynamic>())
        : null;
  }

  @override
  Future<void> write(VoiceProfile? profile) async {
    final prefs = await SharedPreferences.getInstance();
    if (profile == null) {
      await prefs.remove(_profileKey);
    } else {
      await prefs.setString(_profileKey, jsonEncode(profile.toJson()));
    }
  }

  @override
  Future<bool> setupOffered() async =>
      (await SharedPreferences.getInstance()).getBool(_offeredKey) ?? false;

  @override
  Future<void> markSetupOffered() async =>
      (await SharedPreferences.getInstance()).setBool(_offeredKey, true);
}

/// [VoiceCache] in memory (tests, and nothing to keep).
class MemoryVoiceCache implements VoiceCache {
  MemoryVoiceCache({this.profile, this.offered = false});

  VoiceProfile? profile;
  bool offered;

  @override
  Future<VoiceProfile?> read() async => profile;

  @override
  Future<void> write(VoiceProfile? profile) async => this.profile = profile;

  @override
  Future<bool> setupOffered() async => offered;

  @override
  Future<void> markSetupOffered() async => offered = true;
}

/// Everything about the user's voice for live practice: the voiceprint on
/// the server (and its copy on the phone), the speaker model, the embedder
/// and the microphone. The pages take one so tests can swap every piece.
class VoiceRepository {
  VoiceRepository({
    required this.api,
    SpeakerModelStore? models,
    SpeakerEmbedderFactory? createEmbedder,
    LiveMic Function()? createMic,
    VoiceCache? cache,
  }) : models = models ?? FileSpeakerModelStore(api),
       createEmbedder = createEmbedder ?? sherpaSpeakerEmbedder,
       createMic = createMic ?? PlatformLiveMic.new,
       cache = cache ?? PrefsVoiceCache(_scope(api));

  final ApiClient api;
  final SpeakerModelStore models;
  final SpeakerEmbedderFactory createEmbedder;
  final LiveMic Function() createMic;
  final VoiceCache cache;

  /// One cache per signed-in device token, without storing the token.
  static String _scope(ApiClient api) => sha256
      .convert(utf8.encode('${api.serverUrl}|${api.token ?? ''}'))
      .toString()
      .substring(0, 16);

  Future<void> _cacheWrite(VoiceProfile? profile) async {
    try {
      await cache.write(profile);
    } catch (_) {}
  }

  /// The user's voiceprint (null before one is saved). When the server
  /// can't be reached, the copy on the phone.
  Future<VoiceProfile?> profile() async {
    try {
      final profile = await api.getVoiceProfile();
      await _cacheWrite(profile);
      return profile;
    } on ApiException catch (e) {
      if (!e.isNetwork) rethrow;
      try {
        final cached = await cache.read();
        if (cached != null) return cached;
      } catch (_) {}
      rethrow;
    }
  }

  /// The speaker model the server hosts; null when it has none.
  Future<SpeakerModelInfo?> modelInfo() => api.speakerModelInfo();

  Future<VoiceProfile> save({
    required String model,
    required List<double> embedding,
    double threshold = defaultVoiceThreshold,
  }) async {
    final profile = await api.saveVoiceProfile(
      model: model,
      embedding: embedding,
      threshold: threshold,
    );
    await _cacheWrite(profile);
    return profile;
  }

  Future<VoiceProfile> setThreshold(double threshold) async {
    final profile = await api.setVoiceThreshold(threshold);
    await _cacheWrite(profile);
    return profile;
  }

  Future<void> delete() async {
    await api.deleteVoiceProfile();
    await _cacheWrite(null);
  }

  /// What a session needs to tell the user's voice from the interviewer's.
  /// Null when anything is missing (no voiceprint, it was made with another
  /// model, the model isn't on the phone) or fails: then every turn is
  /// answered.
  Future<LiveVoice?> sessionVoice() async {
    try {
      final profile = await this.profile();
      if (profile == null || profile.embedding.isEmpty) return null;
      final info = await modelInfo();
      if (info == null || info.fileName != profile.model) return null;
      final path = await models.localPath(info);
      if (path == null) return null;
      return LiveVoice(
        embedder: createEmbedder(path),
        voiceprint: profile.embedding,
        threshold: profile.threshold,
      );
    } catch (_) {
      return null;
    }
  }

  /// Whether to show the voice setup before a new session: there's no
  /// voiceprint and it hasn't been offered on this phone yet. It counts as
  /// offered from now on.
  Future<bool> offerSetup() async {
    try {
      if (await cache.setupOffered()) return false;
      if (await api.getVoiceProfile() != null) return false;
      await cache.markSetupOffered();
      return true;
    } catch (_) {
      return false;
    }
  }
}
