import { Effect } from 'effect';

import { ResolverError } from '../../errors.ts';
import { matchAnySpecificity, type Resolver } from '../resolver.ts';
import {
  ResolveDecline,
  ResolveFailure,
  type ResolveOutcome,
  ResolveSuccess,
} from '../types.ts';

import {
  fetchRawBody,
  fileExtensionPattern,
  type HttpClientService,
} from './shared.ts';

/**
 * Extensions `fileExtensionPattern` matches that name a server-rendered page
 * rather than a static document/data/binary resource. `fileExtensionPattern`
 * itself only decides whether `raw` *attempts* a URL — it also matches
 * ordinary web pages (`.html`, `.php`, ...), so it can't double as the
 * terminal-failure decision below. Listed here so a `raw` failure on one of
 * these can decline and fall through the chain like the opportunistic
 * built-ins, instead of aborting it as if the URL were a proven-dead
 * `.pdf`/`.csv`/binary resource.
 */
const webPageExtensions = new Set([
  'html',
  'htm',
  'xhtml',
  'shtml',
  'php',
  'phtml',
  'asp',
  'aspx',
  'jsp',
  'jspx',
  'cfm',
  'cgi',
]);

const isWebPageExtension = (extension: string): boolean =>
  webPageExtensions.has(extension.toLowerCase());

/**
 * Matching by file extension is a definitive claim on the URL — unlike the
 * opportunistic built-ins (`direct`, `jina`, ...), there's usually no
 * lower-priority resolver a 404 on a `.pdf`/`.csv`/etc URL should fall
 * through to, so a fetch failure there aborts the chain (`ResolveFailure`)
 * instead of declining, keeping it from burning a paid provider's quota
 * scraping a dead URL. A failure on a web-page-ish extension (see
 * `webPageExtensions`) declines instead, since those extensions also cover
 * ordinary web pages a lower-priority provider can still render.
 */
export const rawResolver = (client: HttpClientService): Resolver => ({
  id: 'raw',
  isDefault: true,
  match: null,
  specificity: matchAnySpecificity,
  run: (url) =>
    Effect.gen(function* () {
      const extensionMatch = fileExtensionPattern.exec(url.pathname);
      if (extensionMatch === null) {
        return new ResolveDecline() satisfies ResolveOutcome;
      }

      const isTerminalFailure = !isWebPageExtension(extensionMatch[0].slice(1));

      return yield* fetchRawBody(client, url.toString()).pipe(
        Effect.map(
          (markdown): ResolveOutcome =>
            new ResolveSuccess({ markdown: markdown }),
        ),
        Effect.catchTag('FetchError', (cause) =>
          Effect.succeed<ResolveOutcome>(
            isTerminalFailure
              ? new ResolveFailure({
                  error: new ResolverError({ id: 'raw', cause: cause }),
                })
              : new ResolveDecline(),
          ),
        ),
      );
    }),
});
