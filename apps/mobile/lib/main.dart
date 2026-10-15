import 'package:flutter/material.dart';

/// The server this build talks to, compiled in by CI
/// (`--dart-define=OFFERPATH_SERVER_URL=http://<server-ip>:50005`).
const serverUrl = String.fromEnvironment(
  'OFFERPATH_SERVER_URL',
  defaultValue: 'http://10.0.2.2:50005',
);

void main() {
  runApp(const OfferpathApp());
}

class OfferpathApp extends StatelessWidget {
  const OfferpathApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Offerpath',
      theme: ThemeData(colorSchemeSeed: const Color(0xFF1F4FD8)),
      darkTheme: ThemeData(
        colorSchemeSeed: const Color(0xFF1F4FD8),
        brightness: Brightness.dark,
      ),
      home: const HomePage(),
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Offerpath')),
      body: const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'Finds the jobs, gets you ready for the interviews, and moves you '
            'one step closer to the offer every day.',
            textAlign: TextAlign.center,
          ),
        ),
      ),
    );
  }
}
