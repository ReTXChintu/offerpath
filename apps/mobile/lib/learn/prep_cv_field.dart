import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../models/interview_prep.dart';
import '../models/mock_interview.dart';
import '../services/api_client.dart';
import 'ui.dart';

/// A CV file the user picked: its name, size and a way to read it.
class PickedCvFile {
  const PickedCvFile({
    required this.name,
    required this.size,
    required this.read,
  });
  final String name;

  /// Bytes; null when the platform can't tell without reading it.
  final int? size;
  final Future<List<int>> Function() read;
}

/// Opens the system file picker for a CV; null when cancelled.
typedef CvFilePicker = Future<PickedCvFile?> Function();

Future<PickedCvFile?> pickCvFile() async {
  final file = await FilePicker.pickFile(
    type: FileType.custom,
    allowedExtensions: cvFileExtensions,
    dialogTitle: 'Pick your CV',
  );
  if (file == null) return null;
  return PickedCvFile(
    name: file.name,
    size: file.lengthSync() ?? await file.length(),
    read: file.readAsBytes,
  );
}

/// The CV part of the prep form: none, the Offerpath profile, an uploaded
/// file (its text read out by the server) or pasted text. Whatever the
/// source, the text is shown so the user can check and fix it.
class PrepCvController extends ChangeNotifier {
  PrepCvController({PrepResume? initial})
    : source = initial?.source,
      fileName = initial?.fileName,
      text = TextEditingController(text: initial?.text ?? '');

  /// Null: no CV.
  PrepResumeSource? source;
  String? fileName;
  final TextEditingController text;
  bool busy = false;
  String? error;

  /// What to send as `resume`; null for none.
  PrepResume? get resume {
    final s = source;
    final t = text.text.trim();
    if (s == null || t.isEmpty) return null;
    return PrepResume(
      source: s,
      text: t,
      fileName: s == PrepResumeSource.upload ? fileName : null,
    );
  }

  /// Why the form can't be sent yet, or null.
  String? validate() {
    if (busy) return 'Wait for your CV to finish loading.';
    if (source != null && text.text.trim().isEmpty) {
      return switch (source!) {
        PrepResumeSource.upload => 'Pick your CV file, or choose No CV.',
        PrepResumeSource.profile =>
          'Your profile has no CV yet. Upload or paste one, or choose No CV.',
        PrepResumeSource.pasted => 'Paste your CV, or choose No CV.',
      };
    }
    return null;
  }

  /// The user edited the text (the character count follows).
  void textChanged() => notifyListeners();

  void _set(VoidCallback change) {
    change();
    notifyListeners();
  }

  void choose(PrepResumeSource? next, ApiClient api) {
    if (next == source) return;
    final keepText = next == PrepResumeSource.pasted;
    _set(() {
      source = next;
      error = null;
      fileName = null;
      if (!keepText) text.clear();
    });
    if (next == PrepResumeSource.profile) loadProfile(api);
  }

  Future<void> loadProfile(ApiClient api) async {
    _set(() {
      busy = true;
      error = null;
    });
    try {
      final cv = await api.profileCv();
      if (source != PrepResumeSource.profile) return;
      if (cv == null) {
        error = 'Your Offerpath profile has no CV details yet. Fill in your profile on the desktop, or upload or paste a CV.';
      } else {
        text.text = cv;
      }
    } catch (e) {
      error = prepErrorMessage(e);
    } finally {
      _set(() => busy = false);
    }
  }

  Future<void> upload(ApiClient api, CvFilePicker picker) async {
    if (busy) return;
    PickedCvFile? file;
    try {
      file = await picker();
    } catch (_) {
      _set(() => error = "Couldn't open that file.");
      return;
    }
    if (file == null) return;
    final problem = cvFileProblem(file.name, file.size);
    if (problem != null) {
      _set(() => error = problem);
      return;
    }
    _set(() {
      busy = true;
      error = null;
    });
    try {
      final bytes = await file.read();
      final sizeProblem = cvFileProblem(file.name, bytes.length);
      if (sizeProblem != null) {
        error = sizeProblem;
        return;
      }
      final extracted = await api.extractCv(file.name, bytes);
      if (source != PrepResumeSource.upload) return;
      if (extracted.text.trim().isEmpty) {
        error = 'No text came out of that file (a scanned PDF?). Paste the text instead.';
        return;
      }
      fileName = extracted.fileName.isEmpty ? file.name : extracted.fileName;
      text.text = extracted.text;
    } catch (e) {
      error = prepErrorMessage(e);
    } finally {
      _set(() => busy = false);
    }
  }

  @override
  void dispose() {
    text.dispose();
    super.dispose();
  }
}

class PrepCvField extends StatelessWidget {
  const PrepCvField({
    required this.controller,
    required this.api,
    this.picker = pickCvFile,
    this.errorText,
    super.key,
  });

  final PrepCvController controller;
  final ApiClient api;
  final CvFilePicker picker;

  /// The form's own complaint (from [PrepCvController.validate]).
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) => _build(context),
    );
  }

  Widget _build(BuildContext context) {
    final theme = Theme.of(context);
    final tone = LearnTone.of(context);
    final c = controller;
    final source = c.source;
    Widget chip(String label, PrepResumeSource? value, IconData icon) =>
        ChoiceChip(
          label: Text(label),
          avatar: Icon(icon, size: 16),
          selected: source == value,
          showCheckmark: false,
          onSelected: c.busy ? null : (_) => c.choose(value, api),
        );
    // The text box once there's something to check: always for pasting, after
    // a file is read, and once the profile CV has loaded.
    final showText =
        c.text.text.isNotEmpty ||
        switch (source) {
          PrepResumeSource.pasted => true,
          PrepResumeSource.upload => c.fileName != null,
          PrepResumeSource.profile => c.error == null,
          null => false,
        };
    final error = c.error ?? errorText;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Your CV',
          style: theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w700,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'The plan and the mock interviewer use it to ask about your own experience.',
          style: TextStyle(fontSize: 12.5, color: tone.muted, height: 1.4),
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            chip('No CV', null, Icons.block),
            chip(
              'Use my Offerpath profile',
              PrepResumeSource.profile,
              Icons.person_outline,
            ),
            chip('Upload a file', PrepResumeSource.upload, Icons.upload_file),
            chip('Paste text', PrepResumeSource.pasted, Icons.content_paste),
          ],
        ),
        if (source == PrepResumeSource.upload) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: c.busy ? null : () => c.upload(api, picker),
                icon: const Icon(Icons.attach_file, size: 18),
                label: Text(
                  c.fileName == null ? 'Choose a file' : 'Choose another file',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  c.fileName ?? 'PDF, Word (.docx), .txt or .md, up to 4 MB.',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12.5,
                    color: c.fileName == null ? tone.muted : tone.strong,
                    fontWeight: c.fileName == null
                        ? FontWeight.normal
                        : FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
        if (c.busy) ...[
          const SizedBox(height: 12),
          Row(
            children: [
              const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: 10),
              Text(
                source == PrepResumeSource.upload
                    ? 'Reading your CV…'
                    : 'Writing a CV from your profile…',
                style: TextStyle(fontSize: 13, color: tone.muted),
              ),
            ],
          ),
        ],
        if (error != null) ...[
          const SizedBox(height: 8),
          Text(
            error,
            style: TextStyle(
              color: theme.colorScheme.error,
              fontSize: 12.5,
              height: 1.4,
            ),
          ),
        ],
        if (showText && !c.busy) ...[
          const SizedBox(height: 12),
          TextField(
            key: const ValueKey('cv-text'),
            controller: c.text,
            minLines: 6,
            maxLines: 14,
            keyboardType: TextInputType.multiline,
            onChanged: (_) => c.textChanged(),
            decoration: InputDecoration(
              labelText: source == PrepResumeSource.pasted
                  ? 'CV text'
                  : 'CV text (check it and fix anything odd)',
              hintText: 'Paste your CV: experience, projects, skills…',
              alignLabelWithHint: true,
              helperText: '${c.text.text.trim().length} characters',
            ),
          ),
        ],
      ],
    );
  }
}
