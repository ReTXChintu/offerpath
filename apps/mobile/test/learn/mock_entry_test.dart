import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:offerpath_mobile/learn/mock_interview_page.dart';
import 'package:offerpath_mobile/learn/prep_create_page.dart';
import 'package:offerpath_mobile/learn/prep_cv_field.dart';
import 'package:offerpath_mobile/learn/prep_detail_page.dart';
import 'package:offerpath_mobile/learn/voice.dart';
import 'package:offerpath_mobile/logic/links.dart';
import 'package:offerpath_mobile/models/interview_prep.dart';

import '../support/fake_api.dart';
import '../support/mock_fixtures.dart';
import '../support/prep_fixtures.dart';

void main() {
  void tallScreen(WidgetTester tester) {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }

  test('MOCK_INTERVIEW_REPORT_READY opens the interview, over Learn', () {
    expect(
      resolveLink('mock-interview', 'm1'),
      const AppLink(LinkKind.mockInterview, 'm1'),
    );
    expect(
      resolveLink('mock-interview', ''),
      const AppLink(LinkKind.interviewPreps),
    );
    expect(
      linkFromPushData({'linkPage': 'mock-interview', 'linkId': 'm1'}),
      const AppLink(LinkKind.mockInterview, 'm1'),
    );
    expect(
      decodeLinkPayload(encodeLinkPayload('mock-interview', 'm1')),
      const AppLink(LinkKind.mockInterview, 'm1'),
    );
    expect(tabFor(const AppLink(LinkKind.mockInterview, 'm1')), tabLearn);
  });

  testWidgets('the prep screen starts a mock interview and lists past ones', (
    tester,
  ) async {
    tallScreen(tester);
    final fake = FakeApi()
      ..on(
        'GET',
        '/api/v1/interview-preps/p1',
        FakeReply.ok(prepJson(mockInterviews: [mockSummaryJson()])),
      )
      ..on(
        'POST',
        '/api/v1/interview-preps/p1/mock-interviews',
        FakeReply.ok(
          mockInterviewJson(
            id: 'm2',
            stage: 'INTRO',
            turns: openingTurns().take(1).toList(),
          ),
        ),
      )
      ..on(
        'GET',
        '/api/v1/mock-interviews/m2',
        FakeReply.ok(
          mockInterviewJson(
            id: 'm2',
            stage: 'INTRO',
            turns: openingTurns().take(1).toList(),
          ),
        ),
      );
    await tester.pumpWidget(
      MaterialApp(
        home: PrepDetailPage(
          api: fake.client(),
          prepId: 'p1',
          voice: FakeVoiceInput(available: false),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Start mock interview'), findsOneWidget);
    expect(find.text('MOCK INTERVIEWS · 1'), findsOneWidget);
    expect(find.text('Completed'), findsOneWidget);
    expect(find.text('7.5/10'), findsOneWidget);
    expect(find.text('4 answered · Lean hire'), findsOneWidget);
    expect(find.text('No CV'), findsOneWidget);

    await tester.tap(find.text('Start mock interview'));
    await tester.pumpAndSettle();
    expect(find.byType(MockInterviewPage), findsOneWidget);
    expect(
      find.textContaining('Tell me about yourself.', findRichText: true),
      findsOneWidget,
    );
    expect(find.text('Frontend developer at Acme'), findsOneWidget);
  });

  testWidgets('an interview in progress offers "Continue"', (tester) async {
    tallScreen(tester);
    final fake = FakeApi()
      ..on(
        'GET',
        '/api/v1/interview-preps/p1',
        FakeReply.ok(
          prepJson(
            mockInterviews: [
              mockSummaryJson(
                status: 'IN_PROGRESS',
                score: null,
                verdict: null,
              ),
            ],
          ),
        ),
      );
    await tester.pumpWidget(
      MaterialApp(
        home: PrepDetailPage(api: fake.client(), prepId: 'p1'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('Continue mock interview'), findsOneWidget);
    expect(find.text('In progress'), findsOneWidget);
  });

  group('CV and DSA on the form', () {
    Future<FakeApi> pump(
      WidgetTester tester, {
      Prep? editing,
      CvFilePicker? picker,
    }) async {
      tallScreen(tester);
      final fake = FakeApi()
        ..on(
          'GET',
          '/api/v1/interview-preps/ai',
          const FakeReply.ok({'source': 'desktop'}),
        )
        ..on(
          'POST',
          '/api/v1/interview-preps',
          FakeReply.ok(prepJson(status: 'GENERATING')),
        )
        ..on(
          'GET',
          '/api/v1/interview-preps/p1',
          FakeReply.ok(prepJson(status: 'GENERATING')),
        )
        ..on(
          'PATCH',
          '/api/v1/interview-preps/p1',
          FakeReply.ok(prepJson(status: 'GENERATING')),
        )
        ..on(
          'POST',
          '/api/v1/interview-preps/cv/extract',
          const FakeReply.ok({
            'text': 'Jane Doe\nSenior engineer',
            'fileName': 'cv.pdf',
            'chars': 24,
          }),
        );
      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => editing == null
                ? PrepCreatePage(
                    api: fake.client(),
                    voice: FakeVoiceInput(available: false),
                    cvPicker: picker ?? pickCvFile,
                  )
                : Scaffold(
                    body: TextButton(
                      onPressed: () => openPrepEdit(
                        context,
                        fake.client(),
                        editing,
                        cvPicker: picker ?? pickCvFile,
                      ),
                      child: const Text('edit'),
                    ),
                  ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      if (editing != null) {
        await tester.tap(find.text('edit'));
        await tester.pumpAndSettle();
      }
      return fake;
    }

    Future<void> tap(WidgetTester tester, Finder finder) async {
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    testWidgets(
      'an uploaded CV is read, shown to check, and sent with DSA on',
      (tester) async {
        final bytes = utf8.encode('%PDF-1.4 fake');
        final fake = await pump(
          tester,
          picker: () async => PickedCvFile(
            name: 'cv.pdf',
            size: bytes.length,
            read: () async => bytes,
          ),
        );
        await tester.enterText(
          find.widgetWithText(TextField, 'Technologies'),
          'Go',
        );
        await tester.testTextInput.receiveAction(TextInputAction.done);
        await tap(tester, find.text('Include DSA questions'));
        await tap(tester, find.text('Upload a file'));
        await tap(tester, find.text('Choose a file'));

        final extract = fake.requests.singleWhere(
          (r) => r.path == '/api/v1/interview-preps/cv/extract',
        );
        expect(extract.body, {
          'fileName': 'cv.pdf',
          'contentBase64': base64Encode(bytes),
        });
        expect(find.text('Jane Doe\nSenior engineer'), findsOneWidget);
        expect(find.text('cv.pdf'), findsOneWidget);

        await tap(tester, find.text('Pick date'));
        await tap(tester, find.text('OK'));
        await tap(tester, find.text('Pick time'));
        await tap(tester, find.text('OK'));
        await tester.ensureVisible(find.text('Prepare'));
        await tester.tap(find.text('Prepare'));
        for (var i = 0; i < 10; i++) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        final body =
            fake.requests
                    .singleWhere(
                      (r) =>
                          r.method == 'POST' &&
                          r.path == '/api/v1/interview-preps',
                    )
                    .body
                as Map;
        expect(body['includeDsa'], isTrue);
        expect(body['resume'], {
          'text': 'Jane Doe\nSenior engineer',
          'source': 'upload',
          'fileName': 'cv.pdf',
        });
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );

    testWidgets('a file of the wrong type is refused before it is sent', (
      tester,
    ) async {
      final fake = await pump(
        tester,
        picker: () async =>
            PickedCvFile(name: 'cv.doc', size: 10, read: () async => [1]),
      );
      await tap(tester, find.text('Upload a file'));
      await tap(tester, find.text('Choose a file'));
      expect(
        find.text('Pick a PDF, Word (.docx), .txt or .md file.'),
        findsOneWidget,
      );
      expect(
        fake.requests.where((r) => r.path.endsWith('/cv/extract')),
        isEmpty,
      );
    });

    testWidgets('editing the job description warns, then sends only that', (
      tester,
    ) async {
      final fake = await pump(tester, editing: Prep.fromJson(prepJson()));
      expect(find.text('Edit interview prep'), findsOneWidget);
      await tester.enterText(
        find.widgetWithText(TextField, 'Job description'),
        'A Go job.',
      );
      await tap(tester, find.text('Save'));
      expect(find.text('Rewrite the plan and questions?'), findsOneWidget);
      await tester.tap(find.text('Save and rewrite'));
      await tester.pumpAndSettle();
      expect(fake.requests.singleWhere((r) => r.method == 'PATCH').body, {
        'jobDescription': 'A Go job.',
      });
      expect(find.byType(PrepCreatePage), findsNothing);
    });

    testWidgets('editing only the company saves without a warning', (
      tester,
    ) async {
      final fake = await pump(tester, editing: Prep.fromJson(prepJson()));
      await tester.enterText(find.widgetWithText(TextField, 'Company'), 'Beta');
      await tap(tester, find.text('Save'));
      expect(find.text('Rewrite the plan and questions?'), findsNothing);
      expect(fake.requests.singleWhere((r) => r.method == 'PATCH').body, {
        'company': 'Beta',
      });
    });
  });
}
