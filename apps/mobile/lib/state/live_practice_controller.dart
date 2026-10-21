import 'dart:async';

import 'package:flutter/foundation.dart';

import '../learn/live/segment_recorder.dart';
import '../learn/live/upload_queue.dart';
import '../models/live_practice.dart';
import '../services/api_client.dart';

/// What the screen says when the microphone permission is refused.
const liveMicDeniedMessage =
    "Offerpath can't use the microphone. Allow it in your phone's settings "
    '(Apps → Offerpath → Permissions), or type what was said below.';

/// One live-practice session on screen: listening (the [SegmentRecorder]
/// cuts the audio, [LiveUploadQueue] sends it in order), typed input, the
/// "answers for" switch, grading, ending, and checking again every
/// [pollEvery] while a grade is being written.
class LivePracticeController extends ChangeNotifier {
  LivePracticeController({
    required this.api,
    required this.sessionId,
    LivePracticeView? initial,
    SegmentRecorder? recorder,
    this.pollEvery = const Duration(seconds: 3),
  }) : view = initial,
       recorder = recorder ?? SegmentRecorder() {
    queue = LiveUploadQueue(onView: _applyFromUpload, onError: _onUploadError)
      ..addListener(_notify);
    _segmentsSub = this.recorder.segments.listen(_upload);
    _schedulePoll();
  }

  final ApiClient api;
  final String sessionId;
  final SegmentRecorder recorder;
  final Duration pollEvery;
  late final LiveUploadQueue queue;
  StreamSubscription<RecordedSegment>? _segmentsSub;
  Timer? _poll;
  bool _disposed = false;
  bool _loading = false;

  /// Bumped by every reply that changes the session, so a poll that started
  /// before one doesn't overwrite it with older data.
  int _version = 0;

  LivePracticeView? view;

  /// Why the first load failed (nothing to show yet).
  Object? loadError;

  /// The mic is on.
  bool listening = false;

  /// Asking for the permission / starting the recorder.
  bool startingMic = false;

  /// Why listening couldn't start (permission refused, ...).
  String? micError;

  /// The last upload that failed ("Missed a segment: ...").
  String? uploadError;

  /// The last failed action, for a snack bar ([takeActionError]).
  String? _actionError;

  /// Questions this phone asked to grade and is waiting on.
  final Set<String> gradingIds = {};

  bool changingAnswerFor = false;
  bool ending = false;

  /// Typed inputs waiting or in flight.
  int sendingText = 0;

  bool get isEnded => view?.isEnded ?? false;

  /// Uploads waiting or in flight.
  int get uploading => queue.pending;

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  void _apply(LivePracticeView next) {
    if (_disposed) return;
    view = next;
    loadError = null;
    _version++;
    _schedulePoll();
    _notify();
  }

  void _applyFromUpload(LivePracticeView next) {
    uploadError = null;
    _apply(next);
  }

  void _onUploadError(String message, Object error) {
    uploadError = message;
    _notify();
  }

  void clearUploadError() {
    if (uploadError == null) return;
    uploadError = null;
    _notify();
  }

  /// The failed action's sentence, once.
  String? takeActionError() {
    final e = _actionError;
    _actionError = null;
    return e;
  }

  void _fail(Object error) {
    _actionError = liveErrorMessage(error);
    _notify();
  }

  Future<void> load() async {
    if (_loading || _disposed) return;
    _loading = true;
    final version = _version;
    try {
      final next = await api.getLivePractice(sessionId);
      // A reply that changed the session came in meanwhile: it's newer.
      if (version == _version) _apply(next);
    } catch (error) {
      if (view == null) loadError = error;
      _notify();
    } finally {
      _loading = false;
      _schedulePoll();
    }
  }

  /// While a grade is being written, check again (not while uploads are
  /// running: their replies bring it).
  void _schedulePoll() {
    _poll?.cancel();
    final current = view;
    if (_disposed || current == null || !current.anyGrading) return;
    _poll = Timer(pollEvery, () {
      if (queue.busy) {
        _schedulePoll();
      } else {
        load();
      }
    });
  }

  void _upload(RecordedSegment segment) {
    unawaited(
      queue.add(
        () => api.sendLivePracticeAudio(
          sessionId,
          segment.bytes,
          durationMs: segment.durationMs,
        ),
      ),
    );
  }

  /// Turns the mic on (asking for the permission first). Returns whether
  /// it's listening.
  Future<bool> startListening() async {
    if (listening || startingMic || isEnded || _disposed) return listening;
    startingMic = true;
    micError = null;
    _notify();
    try {
      if (!await recorder.hasPermission()) {
        micError = liveMicDeniedMessage;
        return false;
      }
      if (_disposed) return false;
      await recorder.start();
      listening = true;
      return true;
    } catch (error) {
      micError = "Couldn't start the microphone: $error";
      return false;
    } finally {
      startingMic = false;
      _notify();
    }
  }

  /// Turns the mic off; what was said so far is still sent.
  Future<void> pauseListening() async {
    if (!listening) return;
    listening = false;
    _notify();
    await recorder.stop();
  }

  Future<void> toggleListening() =>
      listening ? pauseListening() : startListening();

  /// Who the AI answers are written for, from the next question on.
  Future<void> setAnswerFor(AnswerFor answerFor) async {
    final current = view;
    if (current == null ||
        changingAnswerFor ||
        current.answerFor == answerFor) {
      return;
    }
    changingAnswerFor = true;
    _notify();
    try {
      _apply(await api.updateLivePractice(sessionId, answerFor: answerFor));
    } catch (error) {
      _fail(error);
    } finally {
      changingAnswerFor = false;
      _notify();
    }
  }

  /// Grades a question's spoken answer now.
  Future<void> grade(String questionId) async {
    if (gradingIds.contains(questionId)) return;
    gradingIds.add(questionId);
    _notify();
    try {
      _apply(await api.gradeLivePracticeQuestion(sessionId, questionId));
    } catch (error) {
      _fail(error);
    } finally {
      gradingIds.remove(questionId);
      _notify();
    }
  }

  /// Whether [question] is being graded (here or on the server).
  bool isGrading(LiveQuestion question) =>
      question.grading || gradingIds.contains(question.id);

  /// Typed input, queued behind the audio. Returns whether it was sent.
  Future<bool> sendText(String text) async {
    final t = text.trim();
    if (t.isEmpty || isEnded) return false;
    if (t.length > 4000) {
      _actionError = 'Keep it under 4,000 characters.';
      _notify();
      return false;
    }
    sendingText++;
    _notify();
    try {
      return await queue.add(
        () => api.sendLivePracticeText(sessionId, t),
        failurePrefix: "Couldn't send that",
      );
    } finally {
      sendingText--;
      _notify();
    }
  }

  /// Stops listening, sends what's left, and ends the session. Grades are
  /// then written in the background; this checks back until they're in.
  Future<bool> end() async {
    if (ending || isEnded) return false;
    ending = true;
    _notify();
    try {
      await pauseListening();
      await queue.idle;
      _apply(await api.endLivePractice(sessionId));
      return true;
    } catch (error) {
      _fail(error);
      return false;
    } finally {
      ending = false;
      _notify();
    }
  }

  Future<bool> delete() async {
    try {
      await pauseListening();
      await api.deleteLivePractice(sessionId);
      return true;
    } catch (error) {
      _fail(error);
      return false;
    }
  }

  @override
  void dispose() {
    _disposed = true;
    _poll?.cancel();
    _segmentsSub?.cancel();
    queue.removeListener(_notify);
    queue.dispose();
    listening = false;
    unawaited(recorder.dispose());
    super.dispose();
  }
}
