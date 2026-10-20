import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../models/interview_prep.dart';
import '../services/api_client.dart';
import '../state/interview_prep_controller.dart';
import '../widgets/common.dart';
import 'prep_cv_field.dart';
import 'prep_detail_page.dart';
import 'prep_widgets.dart';
import 'ui.dart';
import 'voice.dart';

/// "Prepare for an interview": company, role, the job description (pasted),
/// technologies, DSA questions or not, the CV (from the Offerpath profile, a
/// file, or pasted), and when the interview is. Before sending it says where
/// AI will run: Claude on the laptop, the user's OpenAI key, or nowhere yet
/// (it then starts when the laptop comes online). On success the prep's own
/// screen replaces this one.
///
/// With [editing] it is the same form for an existing prep: it PATCHes only
/// what changed, warns first when a change rewrites the plan and questions
/// (job description, technologies, DSA, CV), and pops with the new prep.
class PrepCreatePage extends StatefulWidget {
  const PrepCreatePage({required this.api, this.preps, this.voice, this.editing, this.cvPicker = pickCvFile, super.key});

  final ApiClient api;
  final InterviewPrepController? preps;

  /// Passed on to the prep screen (for tests).
  final VoiceInput? voice;

  /// The prep being edited; null to create one.
  final Prep? editing;

  /// The system file picker (a fake in tests).
  final CvFilePicker cvPicker;

  @override
  State<PrepCreatePage> createState() => _PrepCreatePageState();
}

class _PrepCreatePageState extends State<PrepCreatePage> {
  late final Prep? _original = widget.editing;
  late final _company = TextEditingController(text: _original?.company ?? '');
  late final _role = TextEditingController(text: _original?.role ?? '');
  late final _jobDescription = TextEditingController(text: _original?.jobDescription ?? '');
  final _technology = TextEditingController();
  late final _technologies = <String>[...?_original?.technologies];
  late final _cv = PrepCvController(initial: _original?.resume);
  late bool _includeDsa = _original?.includeDsa ?? false;
  late DateTime? _date = _original == null ? null : DateUtils.dateOnly(_original.scheduledAt.toLocal());
  late TimeOfDay? _time = _original == null ? null : TimeOfDay.fromDateTime(_original.scheduledAt.toLocal());

  late final Future<PrepAiSource?> _aiSource = widget.api.prepAiSource();
  Map<String, String> _errors = const {};
  String? _submitError;
  bool _busy = false;

  bool get _isEdit => _original != null;

  @override
  void dispose() {
    _company.dispose();
    _role.dispose();
    _jobDescription.dispose();
    _technology.dispose();
    _cv.dispose();
    super.dispose();
  }

  /// Moves what's in the technologies box into chips. Typing a comma (or
  /// pasting a list) adds them as you go.
  void _addTechnologies(String text, {bool all = true}) {
    var input = text;
    var rest = '';
    if (!all) {
      final cut = input.lastIndexOf(RegExp(r'[,;\n]'));
      if (cut < 0) return;
      rest = input.substring(cut + 1);
      input = input.substring(0, cut);
    }
    final added = splitTechnologies(input, existing: _technologies);
    setState(() {
      _technologies.addAll(added);
      _errors = Map.of(_errors)..remove('technologies');
      if (_technologies.isNotEmpty) _errors.remove('jobDescription');
    });
    _technology.value = TextEditingValue(text: rest, selection: TextSelection.collapsed(offset: rest.length));
  }

  int? get _minutes => _time == null ? null : _time!.hour * 60 + _time!.minute;

  DateTime? get _when => _date == null || _time == null ? null : DateTime(_date!.year, _date!.month, _date!.day, _time!.hour, _time!.minute);

  /// Whether the date and time are still the prep's own (editing a prep
  /// whose interview has passed is fine as long as the time isn't moved).
  bool get _whenUnchanged {
    final original = _original;
    final when = _when;
    return original != null && when != null && when.isAtSameMomentAs(original.scheduledAt);
  }

  Future<void> _submit() async {
    if (_busy) return;
    if (_technology.text.trim().isNotEmpty) _addTechnologies(_technology.text);
    final errors = validatePrepForm(
      company: _company.text,
      role: _role.text,
      jobDescription: _jobDescription.text,
      technologies: _technologies,
      date: _date,
      minutesOfDay: _minutes,
    );
    if (_whenUnchanged) errors.remove('time');
    final cvError = _cv.validate();
    if (cvError != null) errors['cv'] = cvError;
    setState(() {
      _errors = errors;
      _submitError = null;
    });
    if (errors.isNotEmpty) return;
    if (_isEdit) return _save();

    setState(() => _busy = true);
    try {
      final prep = await widget.api.createPrep(
        company: _company.text,
        role: _role.text,
        jobDescription: _jobDescription.text,
        technologies: List.of(_technologies),
        scheduledAt: _when!,
        includeDsa: _includeDsa,
        resume: _cv.resume,
      );
      if (!mounted) return;
      widget.preps?.put(prep);
      await Navigator.of(context).pushReplacement(MaterialPageRoute<void>(
        builder: (_) => PrepDetailPage(api: widget.api, prepId: prep.id, preps: widget.preps, voice: widget.voice),
      ));
    } catch (error) {
      // Everything typed stays where it is.
      if (mounted) setState(() => _submitError = prepErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Edit: send what changed, after a warning when the plan is rewritten.
  Future<void> _save() async {
    final original = _original!;
    final jobDescription = _jobDescription.text.trim();
    final resume = _cv.resume;
    final jdChanged = jobDescription != (original.jobDescription ?? '').trim();
    final techChanged = !listEquals(_technologies, original.technologies);
    final dsaChanged = _includeDsa != original.includeDsa;
    final cvChanged = resume == null ? original.resume != null : !resume.sameAs(original.resume);
    final companyChanged = _company.text.trim() != (original.company ?? '');
    final roleChanged = _role.text.trim() != (original.role ?? '');
    final whenChanged = !_whenUnchanged;
    final rewrites = jdChanged || techChanged || dsaChanged || cvChanged;

    if (!rewrites && !companyChanged && !roleChanged && !whenChanged) {
      Navigator.of(context).pop();
      return;
    }
    if (rewrites) {
      final ok = await confirmDialog(
        context,
        title: 'Rewrite the plan and questions?',
        message: 'Changing the job description, technologies, DSA questions or your CV writes a new plan and new practice questions. '
            'Your practice answers on the current questions will be lost.',
        confirm: 'Save and rewrite',
      );
      if (!ok || !mounted) return;
    }

    setState(() => _busy = true);
    try {
      final prep = await widget.api.updatePrep(
        original.id,
        company: companyChanged ? _company.text : null,
        role: roleChanged ? _role.text : null,
        scheduledAt: whenChanged ? _when : null,
        jobDescription: jdChanged ? jobDescription : null,
        technologies: techChanged ? List.of(_technologies) : null,
        includeDsa: dsaChanged ? _includeDsa : null,
        resume: cvChanged ? resume : null,
        removeResume: cvChanged && resume == null,
      );
      if (!mounted) return;
      widget.preps?.put(prep);
      Navigator.of(context).pop(prep);
    } catch (error) {
      if (mounted) setState(() => _submitError = prepErrorMessage(error));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tone = LearnTone.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(_isEdit ? 'Edit interview prep' : 'Prepare for an interview')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 40),
        children: [
          Text(
            _isEdit
                ? 'Company, role and time change at once. Changing the job description, technologies, DSA questions or your CV writes a new plan and new questions.'
                : 'Paste the job description, or list the technologies, and say when the interview is. AI writes a plan up to the day and the questions you are likely to get.',
            style: TextStyle(fontSize: 13, color: tone.muted, height: 1.5),
          ),
          const SizedBox(height: 16),
          LayoutBuilder(builder: (context, constraints) {
            final company = TextField(
              controller: _company,
              textCapitalization: TextCapitalization.words,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: 'Company', hintText: 'Acme', errorText: _errors['company']),
            );
            final role = TextField(
              controller: _role,
              textCapitalization: TextCapitalization.sentences,
              textInputAction: TextInputAction.next,
              decoration: InputDecoration(labelText: 'Role', hintText: 'Backend developer', errorText: _errors['role']),
            );
            // Side by side when there's room, stacked on a narrow phone.
            if (constraints.maxWidth >= 560) {
              return Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: company), const SizedBox(width: 12), Expanded(child: role)]);
            }
            return Column(children: [company, const SizedBox(height: 12), role]);
          }),
          const SizedBox(height: 12),
          TextField(
            controller: _jobDescription,
            minLines: 6,
            maxLines: 16,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) {
              if (_errors.containsKey('jobDescription')) setState(() => _errors = Map.of(_errors)..remove('jobDescription'));
            },
            decoration: InputDecoration(
              labelText: 'Job description',
              hintText: 'Paste the whole posting: responsibilities, requirements, the stack…',
              alignLabelWithHint: true,
              errorText: _errors['jobDescription'],
              errorMaxLines: 2,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _technology,
            textInputAction: TextInputAction.done,
            onChanged: (text) => _addTechnologies(text, all: false),
            onSubmitted: (text) => _addTechnologies(text),
            decoration: InputDecoration(
              labelText: 'Technologies',
              hintText: 'React, Node.js, PostgreSQL',
              helperText: 'Press enter or type a comma after each one.',
              errorText: _errors['technologies'],
              suffixIcon: IconButton(tooltip: 'Add technology', icon: const Icon(Icons.add), onPressed: () => _addTechnologies(_technology.text)),
            ),
          ),
          if (_technologies.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 6, runSpacing: 6, children: [
              for (final t in _technologies)
                InputChip(
                  label: Text(t),
                  onDeleted: () => setState(() => _technologies.remove(t)),
                  deleteButtonTooltipMessage: 'Remove $t',
                ),
            ]),
          ],
          const SizedBox(height: 8),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _includeDsa,
            onChanged: _busy ? null : (v) => setState(() => _includeDsa = v),
            title: const Text('Include DSA questions'),
            subtitle: Text('Data structures and algorithms: practice questions, and DSA problems in mock interviews.', style: TextStyle(fontSize: 12.5, color: tone.muted)),
          ),
          const SizedBox(height: 12),
          PrepCvField(controller: _cv, api: widget.api, picker: widget.cvPicker, errorText: _errors['cv']),
          const SizedBox(height: 20),
          Text('When is the interview?', style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          PrepWhenFields(
            date: _date,
            time: _time,
            dateError: _errors['date'],
            timeError: _errors['time'],
            onDate: (d) => setState(() {
              _date = d;
              _errors = Map.of(_errors)
                ..remove('date')
                ..remove('time');
            }),
            onTime: (t) => setState(() {
              _time = t;
              _errors = Map.of(_errors)..remove('time');
            }),
          ),
          const SizedBox(height: 4),
          Text('Your local time.', style: TextStyle(fontSize: 11.5, color: tone.muted)),
          const SizedBox(height: 20),
          FutureBuilder<PrepAiSource?>(
            future: _aiSource,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return _AiLine(icon: Icons.hourglass_empty, text: 'Checking where AI will run…', color: tone.muted);
              }
              if (snapshot.hasError) return const SizedBox.shrink();
              final source = snapshot.data;
              return _AiLine(
                icon: switch (source) { PrepAiSource.desktop => Icons.laptop_mac, PrepAiSource.openai => Icons.key_outlined, null => Icons.schedule },
                text: prepAiSourceLine(source),
                color: source == null ? LearnTone.warn : tone.accent,
              );
            },
          ),
          if (_submitError != null) ...[
            const SizedBox(height: 12),
            Text(_submitError!, style: TextStyle(color: theme.colorScheme.error, height: 1.4)),
          ],
          const SizedBox(height: 16),
          FilledButton.icon(
            onPressed: _busy ? null : _submit,
            icon: _busy ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)) : Icon(_isEdit ? Icons.check : Icons.auto_awesome),
            label: Text(_isEdit ? 'Save' : 'Prepare'),
          ),
        ],
      ),
    );
  }
}

class _AiLine extends StatelessWidget {
  const _AiLine({required this.icon, required this.text, required this.color});

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(10)),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(icon, size: 18, color: color),
        const SizedBox(width: 10),
        Expanded(child: Text(text, style: TextStyle(color: LearnTone.of(context).body, fontSize: 13, height: 1.4))),
      ]),
    );
  }
}

/// Opens the create screen.
Future<void> openPrepCreate(BuildContext context, ApiClient api, {InterviewPrepController? preps}) =>
    Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => PrepCreatePage(api: api, preps: preps)));

/// Opens the edit form for [prep]; returns the saved prep (null when
/// nothing was saved).
Future<Prep?> openPrepEdit(BuildContext context, ApiClient api, Prep prep, {InterviewPrepController? preps, CvFilePicker cvPicker = pickCvFile}) =>
    Navigator.of(context).push<Prep>(MaterialPageRoute<Prep>(builder: (_) => PrepCreatePage(api: api, preps: preps, editing: prep, cvPicker: cvPicker)));
