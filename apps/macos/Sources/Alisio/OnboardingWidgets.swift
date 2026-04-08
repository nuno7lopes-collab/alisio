import AppKit
import SwiftUI

import AlisioSupport
struct LumeOnboardingIcon: View {
    @Environment(\.scenePhase) private var scenePhase

    @State private var breathe = false

    var body: some View {
        let size: CGFloat = 138
        let glowBlurRadius: CGFloat = 22
        let glowCanvasSize: CGFloat = size + 68
        let palette = LumePalette.resolve(theme: .dark, systemScheme: .dark)
        ZStack {
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            palette.accent.opacity(0.26),
                            palette.accent.opacity(0.06),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing))
                .frame(width: glowCanvasSize, height: glowCanvasSize)
                .padding(glowBlurRadius)
                .blur(radius: glowBlurRadius)
                .scaleEffect(self.breathe ? 1.08 : 0.96)
                .opacity(0.92)

            LumeBrandMark(palette: palette, size: size)
                .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
                .scaleEffect(self.breathe ? 1.02 : 1.0)
        }
        .frame(
            width: glowCanvasSize + (glowBlurRadius * 2),
            height: glowCanvasSize + (glowBlurRadius * 2))
        .onAppear { self.updateBreatheAnimation() }
        .onDisappear { self.breathe = false }
        .onChange(of: self.scenePhase) { _, _ in
            self.updateBreatheAnimation()
        }
    }

    private func updateBreatheAnimation() {
        guard self.scenePhase == .active else {
            self.breathe = false
            return
        }
        guard !self.breathe else { return }
        withAnimation(Animation.easeInOut(duration: 3.6).repeatForever(autoreverses: true)) {
            self.breathe = true
        }
    }
}
