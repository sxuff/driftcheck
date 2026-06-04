# Run from the driftcheck repository root:
#   MSYS_NO_PATHCONV=1 docker run --rm \
#     -v "$(pwd -W):/vhs" \
#     -w /vhs \
#     ghcr.io/charmbracelet/vhs \
#     driftcheck-demo.tape

Output docs/demo.gif

Set Shell "bash"
Set Width 1400
Set Height 700
Set FontSize 16
Set FontFamily "JetBrains Mono"
Set Theme "TokyoNight"
Set Padding 24
Set Margin 20
Set MarginFill "#0b1020"
Set BorderRadius 14
Set WindowBar Colorful
Set TypingSpeed 36ms
Set Framerate 30
Set PlaybackSpeed 1
Set CursorBlink false
Set WaitTimeout 120s

Hide
Type "DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git nodejs npm >/dev/null && printf 'VHS_DEPS_READY\n'"
Enter
Wait+Screen /(?m)^VHS_DEPS_READY$/
Type "rm -rf /tmp/driftcheck-source && mkdir /tmp/driftcheck-source && cp /vhs/package.json /vhs/package-lock.json /vhs/tsconfig.json /tmp/driftcheck-source/ && cp -R /vhs/src /tmp/driftcheck-source/ && cd /tmp/driftcheck-source && npm ci >/dev/null 2>&1 && npm run build >/dev/null 2>&1 && printf 'VHS_BUILD_READY\n'"
Enter
Wait+Screen /(?m)^VHS_BUILD_READY$/
Type "bash /vhs/docs/driftcheck-demo-setup.sh && printf 'VHS_DEMO_READY\n'"
Enter
Wait+Screen /(?m)^VHS_DEMO_READY$/
Type "cd /tmp/driftcheck-demo && printf 'VHS_CD_READY\n'"
Enter
Wait+Screen /(?m)^VHS_CD_READY$/
Type "clear && printf 'VHS_CLEAR_READY\n'"
Enter
Wait+Screen /(?m)^VHS_CLEAR_READY$/
Type "clear"
Enter
Sleep 1s
Show

Sleep 700ms
Type "# AI changed code. Check the diff before commit."
Enter
Sleep 600ms
Type "driftcheck diff"
Enter
Wait+Screen /driftcheck found/
Sleep 5s
