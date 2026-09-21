# OpenAI Apps SDK UI icons

The SVG React components in this directory are selected, unmodified copies from the OpenAI Apps SDK UI repository:

- Repository: `https://github.com/openai/apps-sdk-ui`
- Source revision: `0f00143c7a639906f1621fe58e1b6be7b5bea46d`
- Source directory: `src/components/Icon/svg`
- Imported on: 2026-09-20

Only icons used by Cypheria's shared chat components are included: `AddSources`, `Agent`, `ArrowDown`, `ArrowUp`, `Branch`, `CloseBold`, `Dock`, `Error`, `File`, `Globe`, `PlusComposer`, `PullRequestOpen`, `SidebarRight`, `Stop`, and `Terminal`. SVG path data is unchanged. Cypheria formatting, a non-shadowing local name for `Error`, and `aria-hidden="true"` were added because these icons are decorative inside controls that provide their own accessible names. `index.ts` adds Cypheria's `Icon`-suffixed named exports.

## License

Copyright 2025 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the “Software”), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
