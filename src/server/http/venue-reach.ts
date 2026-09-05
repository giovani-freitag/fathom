import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/** The only scheme a connector may name. */
const ALLOWED_PROTOCOL = 'https:';

/** The only port, because 443 is where the scheme is served. */
const ALLOWED_PORT = '443';

/**
 * Why a URL will not be fetched on a connector's behalf.
 *
 * Every reason is one sentence, because it is shown to whoever asked.
 */
export class VenueRefusedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'VenueRefusedError';
    }
}

/**
 * Whether an address belongs to a network the internet cannot reach.
 *
 * The whole of the defence. The address arrives from a page, so without this
 * the server is a machine anyone can point at its own network — at a database
 * on a private subnet, at a metadata endpoint holding cloud credentials, at
 * itself.
 *
 * @param address - One IPv4 or IPv6 address, as text.
 * @returns True when the address is private, loopback, link-local, or reserved.
 */
export function isPrivateAddress(address: string): boolean {
    const kind = isIP(address);
    if (kind === 4) {
        return isPrivateIpv4(address);
    }
    if (kind === 6) {
        return isPrivateIpv6(address);
    }
    // Anything that is not an address at all is refused, because everything
    // downstream of here assumes this answered about one.
    return true;
}

/**
 * The URL, refused unless the server is willing to fetch it.
 *
 * Resolved as well as parsed: a name is refused by what it points at, and
 * `localhost`, a name in a private zone and a public name pointed at 127.0.0.1
 * are all the same request wearing different clothes.
 *
 * @param candidate - The URL a connector named.
 * @param resolve - Turns a hostname into addresses; injected for tests.
 * @returns The URL, unchanged, once it has been allowed.
 * @throws VenueRefusedError when the scheme, the port or the address is refused.
 */
export async function readReachableUrl(
    candidate: string,
    resolve: typeof lookup = lookup,
): Promise<string> {
    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        throw new VenueRefusedError('That is not a URL.');
    }

    if (parsed.protocol !== ALLOWED_PROTOCOL) {
        throw new VenueRefusedError(`Only https is fetched, not ${parsed.protocol}`);
    }
    if (parsed.port !== '' && parsed.port !== ALLOWED_PORT) {
        throw new VenueRefusedError('Only port 443 is fetched.');
    }
    if (parsed.username !== '' || parsed.password !== '') {
        throw new VenueRefusedError('A URL carrying credentials is not fetched.');
    }

    const addresses = await resolveAll(parsed.hostname, resolve);
    if (addresses.length === 0) {
        throw new VenueRefusedError('That host does not resolve.');
    }
    // Every address, not the first: a name answering with one public address
    // and one private one is the ordinary shape of this attack.
    if (addresses.some(isPrivateAddress)) {
        throw new VenueRefusedError('That host is on a network this server will not reach.');
    }

    return parsed.toString();
}

/**
 * Every address a hostname answers with, or the address it already is.
 */
async function resolveAll(hostname: string, resolve: typeof lookup): Promise<string[]> {
    // A bracketed IPv6 literal arrives with its brackets still on.
    const bare = hostname.startsWith('[') && hostname.endsWith(']')
        ? hostname.slice(1, -1)
        : hostname;
    if (isIP(bare) !== 0) {
        return [bare];
    }

    try {
        const found = await resolve(bare, { all: true });
        return found.map((one) => one.address);
    } catch {
        return [];
    }
}

/**
 * Whether an IPv4 address is one the internet does not route.
 */
function isPrivateIpv4(address: string): boolean {
    const parts = address.split('.').map(Number);
    const [first = 0, second = 0] = parts;

    return first === 0
        || first === 10
        || first === 127
        || (first === 100 && second >= 64 && second <= 127)
        || (first === 169 && second === 254)
        || (first === 172 && second >= 16 && second <= 31)
        || (first === 192 && second === 168)
        || (first === 198 && (second === 18 || second === 19))
        || first >= 224;
}

/**
 * Whether an IPv6 address is one the internet does not route.
 */
function isPrivateIpv6(address: string): boolean {
    const held = address.toLowerCase();
    if (held === '::' || held === '::1') {
        return true;
    }
    // A mapped IPv4 address is an IPv4 address wearing a prefix, and refusing it
    // by its shape rather than by what it maps to is the classic bypass.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(held);
    if (mapped !== null) {
        return isPrivateIpv4(mapped[1]!);
    }

    return held.startsWith('fc')
        || held.startsWith('fd')
        || held.startsWith('fe8')
        || held.startsWith('fe9')
        || held.startsWith('fea')
        || held.startsWith('feb')
        || held.startsWith('ff');
}
