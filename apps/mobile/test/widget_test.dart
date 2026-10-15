import 'package:flutter_test/flutter_test.dart';

import 'package:offerpath_mobile/main.dart';

void main() {
  testWidgets('shows the product name', (tester) async {
    await tester.pumpWidget(const OfferpathApp());
    expect(find.text('Offerpath'), findsOneWidget);
  });
}
