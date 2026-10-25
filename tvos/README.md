# Family TV for Apple TV

A native tvOS app for the family library. It uses the same lock server and pCloud folder as johnsolomon.org/stream.

- FamilyTV/ — the app (SwiftUI + Apple's own video player)
- project.yml — project settings; GitHub turns it into FamilyTV.xcodeproj and checks that it builds
- make_assets.py — draws the app icon and Top Shelf banner

Install: open FamilyTV.xcodeproj in Xcode, pick your team under Signing & Capabilities, choose the Apple TV as the run destination, press Run.
