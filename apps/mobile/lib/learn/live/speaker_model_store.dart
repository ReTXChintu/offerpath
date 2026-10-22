import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

import '../../models/live_practice.dart';
import '../../services/api_client.dart';

/// The speaker model on the phone: downloaded once from the server
/// (`GET /downloads/speaker-model/file`), checked against its sha256, and
/// kept in the app's support directory.
abstract interface class SpeakerModelStore {
  /// The file of [info] when it's on the phone and checked; null otherwise.
  Future<String?> localPath(SpeakerModelInfo info);

  /// Downloads [info] and checks its sha256; returns the file's path.
  /// [onProgress] gets 0 to 1 (null when the size is unknown).
  Future<String> download(
    SpeakerModelInfo info, {
    void Function(double? progress)? onProgress,
  });
}

/// A download that arrived damaged (its sha256 doesn't match).
class SpeakerModelException implements Exception {
  const SpeakerModelException(this.message);

  final String message;

  @override
  String toString() => message;
}

/// [SpeakerModelStore] on files. Next to the model sits `<name>.sha256`,
/// written once its hash has been checked, so it isn't hashed again on every
/// session; a different hash from the server means downloading it again.
class FileSpeakerModelStore implements SpeakerModelStore {
  FileSpeakerModelStore(this.api, {Future<Directory> Function()? directory})
    : _directory = directory ?? _supportDirectory;

  final ApiClient api;
  final Future<Directory> Function() _directory;

  static Future<Directory> _supportDirectory() async => Directory(
    '${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}speaker-model',
  );

  /// The server's file name, safe as a local one.
  static String localName(SpeakerModelInfo info) {
    final safe = info.fileName.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '_');
    return safe.isEmpty || safe.startsWith('.') ? 'speaker-model.onnx' : safe;
  }

  Future<File> _file(SpeakerModelInfo info) async {
    final dir = await _directory();
    return File('${dir.path}${Platform.pathSeparator}${localName(info)}');
  }

  static File _checked(File model) => File('${model.path}.sha256');

  static Future<String> sha256Of(File file) async =>
      (await sha256.bind(file.openRead()).first).toString();

  @override
  Future<String?> localPath(SpeakerModelInfo info) async {
    final file = await _file(info);
    if (!await file.exists()) return null;
    if (info.sizeBytes > 0 && await file.length() != info.sizeBytes) {
      return null;
    }
    final checked = _checked(file);
    if (await checked.exists() &&
        (await checked.readAsString()).trim() == info.sha256) {
      return file.path;
    }
    if (await sha256Of(file) != info.sha256) return null;
    await checked.writeAsString(info.sha256, flush: true);
    return file.path;
  }

  @override
  Future<String> download(
    SpeakerModelInfo info, {
    void Function(double? progress)? onProgress,
  }) async {
    final file = await _file(info);
    final dir = file.parent;
    await dir.create(recursive: true);
    final part = File('${file.path}.part');
    try {
      await api.downloadFile(
        info.url,
        part.path,
        onProgress: (received, total) {
          final size = total > 0 ? total : info.sizeBytes;
          onProgress?.call(size > 0 ? (received / size).clamp(0.0, 1.0) : null);
        },
      );
      if (await sha256Of(part) != info.sha256) {
        throw const SpeakerModelException(
          "The voice model didn't download properly (its checksum doesn't match). Try again.",
        );
      }
      final checked = _checked(file);
      if (await checked.exists()) await checked.delete();
      await part.rename(file.path);
      await checked.writeAsString(info.sha256, flush: true);
    } finally {
      if (await part.exists()) await part.delete();
    }
    // Older models are of no use any more.
    await for (final entity in dir.list()) {
      final name = entity.uri.pathSegments.last;
      final keep = localName(info);
      if (entity is File && name != keep && name != '$keep.sha256') {
        try {
          await entity.delete();
        } catch (_) {}
      }
    }
    return file.path;
  }
}
