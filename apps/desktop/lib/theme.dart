import "package:flutter/material.dart";
import "package:google_fonts/google_fonts.dart";

ThemeData buildLumeTheme() {
  const background = Color(0xFFF3F0EA);
  const surface = Color(0xFFFFFCF7);
  const surfaceSoft = Color(0xFFF8F3EC);
  const ink = Color(0xFF181613);
  const accent = Color(0xFFB7562A);
  const accentSecondary = Color(0xFF2C6A62);
  const accentSoft = Color(0xFFECD8C9);

  final base = ThemeData.light(useMaterial3: true);
  final textTheme = GoogleFonts.manropeTextTheme(base.textTheme).copyWith(
    headlineLarge: GoogleFonts.spaceGrotesk(
      fontSize: 34,
      fontWeight: FontWeight.w700,
      color: ink,
    ),
    headlineMedium: GoogleFonts.spaceGrotesk(
      fontSize: 24,
      fontWeight: FontWeight.w700,
      color: ink,
    ),
    titleLarge: GoogleFonts.spaceGrotesk(
      fontSize: 18,
      fontWeight: FontWeight.w700,
      color: ink,
    ),
    bodyLarge: GoogleFonts.manrope(
      fontSize: 16,
      height: 1.5,
      color: ink,
    ),
    bodyMedium: GoogleFonts.manrope(
      fontSize: 14,
      height: 1.5,
      color: ink.withOpacity(0.78),
    ),
    labelLarge: GoogleFonts.manrope(
      fontSize: 13,
      fontWeight: FontWeight.w700,
      color: ink.withOpacity(0.74),
    ),
  );

  return base.copyWith(
    scaffoldBackgroundColor: background,
    textTheme: textTheme,
    colorScheme: ColorScheme.fromSeed(
      seedColor: accent,
      brightness: Brightness.light,
      primary: accent,
      secondary: accentSecondary,
      surface: surface,
      onSurface: ink,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: surface,
      shape: RoundedRectangleBorder(
        borderRadius: const BorderRadius.all(Radius.circular(24)),
        side: BorderSide(color: ink.withOpacity(0.08)),
      ),
    ),
    dividerColor: ink.withOpacity(0.08),
    shadowColor: ink,
    snackBarTheme: SnackBarThemeData(
      backgroundColor: ink.withOpacity(0.92),
      contentTextStyle: GoogleFonts.ibmPlexSans(
        color: Colors.white,
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
      ),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thumbColor: WidgetStatePropertyAll(ink.withOpacity(0.18)),
      trackColor: WidgetStatePropertyAll(ink.withOpacity(0.04)),
      radius: const Radius.circular(999),
      thickness: const WidgetStatePropertyAll(6),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: accent,
        foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        textStyle: GoogleFonts.manrope(
          fontSize: 14,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: ink,
        side: BorderSide(color: ink.withOpacity(0.12)),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: accentSoft.withOpacity(0.52),
      side: BorderSide(color: accent.withOpacity(0.08)),
      selectedColor: accentSoft,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
      ),
      labelStyle: GoogleFonts.manrope(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        color: ink,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: surfaceSoft,
      helperMaxLines: 3,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: ink.withOpacity(0.10)),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: BorderSide(color: ink.withOpacity(0.10)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: accent, width: 1.5),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
    ),
  );
}
