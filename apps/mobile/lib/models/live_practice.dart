/// Live practice: two people practise interviews face to face with the phone
/// on the table. The account owner is the interviewee; the phone recognises
/// their voice on the device, streams the microphone to OpenAI Realtime (with
/// a short-lived pass from the API) and shows a direct answer to every
/// question the interviewer asks as it's written; each question and answer is
/// saved. Mirrors the API's types (`docs/live-practice.md`). Every field is
/// read defensively: the server can be a version ahead of this app.
library;

import '../services/api_client.dart';
import 'json.dart';

/// Who a saved answer was written for. The phone always gets answers for the
/// user (from their CV) now; `neutral` only shows on exchanges saved before.
enum AnswerFor { me, neutral }

enum LiveStatus { active, ended }

AnswerFor answerForOf(dynamic v) =>
    str(v).toLowerCase() == 'neutral' ? AnswerFor.neutral : AnswerFor.me;

LiveStatus liveStatusOf(dynamic v) =>
    str(v).toUpperCase() == 'ENDED' ? LiveStatus.ended : LiveStatus.active;

/// The sentence to show for a failed live-practice call. A 503 here means
/// OpenAI refused (never the desktop), so it doesn't use
/// [ApiException.message]'s desktop-offline wording: it shows OpenAI's own
/// message, which the API passes on as the detail.
String liveErrorMessage(Object? error) {
  if (error is ApiException) {
    if (error.isNetwork) return error.title;
    if (error.status == 503 || error.kind == 'ai-unavailable') {
      final detail = error.detail?.trim() ?? '';
      return detail.isNotEmpty ? detail : "OpenAI didn't answer.";
    }
    return error.message;
  }
  return "Couldn't reach the Offerpath server. Check your connection.";
}

/// `GET /live-practice/ready`.
class LiveReady {
  const LiveReady({required this.ready, this.reason});

  factory LiveReady.fromJson(Map<String, dynamic> j) =>
      LiveReady(ready: boolOf(j['ready']), reason: optStr(j['reason']));

  final bool ready;

  /// Why it can't start (no OpenAI key saved, ...).
  final String? reason;
}

/// One saved question and its answer.
class LiveExchange {
  const LiveExchange({
    required this.id,
    required this.order,
    required this.question,
    required this.answer,
    required this.answerFor,
    this.createdAt,
  });

  factory LiveExchange.fromJson(Map<String, dynamic> j) => LiveExchange(
    id: str(j['id']),
    order: intOf(j['order']),
    question: str(j['question']),
    answer: str(j['answer']),
    answerFor: answerForOf(j['answerFor']),
    createdAt: dateOf(j['createdAt']),
  );

  final String id;

  /// 0-based.
  final int order;
  final String question;
  final String answer;
  final AnswerFor answerFor;
  final DateTime? createdAt;
}

/// A whole live-practice session.
class LivePracticeView {
  const LivePracticeView({
    required this.id,
    this.prepId,
    required this.title,
    required this.technologies,
    required this.answerFor,
    required this.status,
    required this.exchanges,
    this.createdAt,
    this.endedAt,
  });

  factory LivePracticeView.fromJson(Map<String, dynamic> j) => LivePracticeView(
    id: str(j['id']),
    prepId: optStr(j['prepId']),
    title: str(j['title'], 'Live practice'),
    technologies: strList(j['technologies']),
    answerFor: answerForOf(j['answerFor']),
    status: liveStatusOf(j['status']),
    exchanges: mapList(j['exchanges']).map(LiveExchange.fromJson).toList()
      ..sort((a, b) => a.order.compareTo(b.order)),
    createdAt: dateOf(j['createdAt']),
    endedAt: dateOf(j['endedAt']),
  );

  final String id;
  final String? prepId;
  final String title;
  final List<String> technologies;
  final AnswerFor answerFor;
  final LiveStatus status;

  /// Oldest first.
  final List<LiveExchange> exchanges;
  final DateTime? createdAt;
  final DateTime? endedAt;

  bool get isEnded => status == LiveStatus.ended;
  bool get isActive => status == LiveStatus.active;
}

/// One row of `GET /live-practice`.
class LivePracticeSummary {
  const LivePracticeSummary({
    required this.id,
    this.prepId,
    required this.title,
    required this.status,
    required this.exchanges,
    this.createdAt,
    this.endedAt,
  });

  factory LivePracticeSummary.fromJson(Map<String, dynamic> j) {
    final n = j['exchanges'];
    return LivePracticeSummary(
      id: str(j['id']),
      prepId: optStr(j['prepId']),
      title: str(j['title'], 'Live practice'),
      status: liveStatusOf(j['status']),
      exchanges: n is List ? n.length : intOf(n),
      createdAt: dateOf(j['createdAt']),
      endedAt: dateOf(j['endedAt']),
    );
  }

  final String id;
  final String? prepId;
  final String title;
  final LiveStatus status;

  /// How many questions were answered and saved.
  final int exchanges;
  final DateTime? createdAt;
  final DateTime? endedAt;
}

/// `POST /live-practice/:id/realtime`: a short-lived OpenAI Realtime client
/// secret. The phone connects with it straight to OpenAI; the user's key
/// never leaves the server.
class RealtimePass {
  const RealtimePass({
    required this.clientSecret,
    required this.model,
    required this.url,
    this.expiresAt,
  });

  factory RealtimePass.fromJson(Map<String, dynamic> j) {
    final model = str(j['model'], 'gpt-realtime');
    final url = str(j['url']).trim();
    return RealtimePass(
      clientSecret: str(j['clientSecret']),
      model: model,
      url: url.isNotEmpty
          ? url
          : 'wss://api.openai.com/v1/realtime?model=${Uri.encodeQueryComponent(model)}',
      expiresAt: dateOf(j['expiresAt']),
    );
  }

  /// `ek_...`, for the WebSocket's `Authorization: Bearer` header.
  final String clientSecret;
  final String model;

  /// `wss://api.openai.com/v1/realtime?model=<model>`.
  final String url;

  /// The secret must be used to connect before then.
  final DateTime? expiresAt;
}

/// The match threshold a new voiceprint gets.
const defaultVoiceThreshold = 0.5;

/// `GET /live-practice/voice`: the user's voiceprint, the average of the
/// speaker model's embeddings of three sentences they read. A turn whose
/// embedding is at least [threshold] similar (cosine) is the user's.
class VoiceProfile {
  const VoiceProfile({
    required this.model,
    required this.embedding,
    required this.threshold,
    this.updatedAt,
  });

  factory VoiceProfile.fromJson(Map<String, dynamic> j) {
    final raw = j['embedding'];
    return VoiceProfile(
      model: str(j['model']),
      embedding: raw is List
          ? raw.map(doubleOrNull).whereType<double>().toList()
          : const [],
      threshold: doubleOrNull(j['threshold']) ?? defaultVoiceThreshold,
      updatedAt: dateOf(j['updatedAt']),
    );
  }

  /// The speaker model's file name; a different model means recording again.
  final String model;
  final List<double> embedding;

  /// 0-1: at or above it, a turn is the user's.
  final double threshold;
  final DateTime? updatedAt;

  Map<String, Object?> toJson() => {
    'model': model,
    'embedding': embedding,
    'threshold': threshold,
    'updatedAt': updatedAt?.toIso8601String(),
  };
}

/// `GET /downloads/speaker-model`: the speaker model the server hosts.
class SpeakerModelInfo {
  const SpeakerModelInfo({
    required this.fileName,
    required this.sizeBytes,
    required this.sha256,
    required this.url,
  });

  factory SpeakerModelInfo.fromJson(Map<String, dynamic> j) {
    final url = str(j['url']).trim();
    return SpeakerModelInfo(
      fileName: str(j['fileName']),
      sizeBytes: intOf(j['sizeBytes']),
      sha256: str(j['sha256']).trim().toLowerCase(),
      url: url.isNotEmpty ? url : '/api/v1/downloads/speaker-model/file',
    );
  }

  /// E.g. `wespeaker_en_voxceleb_resnet34_LM.onnx`; a voice profile names it.
  final String fileName;
  final int sizeBytes;

  /// Hex, lower case.
  final String sha256;

  /// A server path (`/api/v1/downloads/speaker-model/file`).
  final String url;
}
