import { describe, expect, it } from 'vitest';
import { isPrivateAddress, readReachableUrl, VenueRefusedError } from '../../../src/server/http/venue-reach.ts';

/** Answers with whatever a test wants a name to point at. */
function resolveTo(...addresses: string[]) {
    return (() => Promise.resolve(addresses.map((address) => ({
        address,
        family: address.includes(':') ? 6 : 4,
    })))) as never;
}

/** Refuses to resolve, the way a name that does not exist does. */
const resolveNothing = (() => Promise.reject(new Error('ENOTFOUND'))) as never;

describe('an address the internet does not route', () => {
    it('names every private IPv4 range', () => {
        for (const address of [
            '0.0.0.0', '10.1.2.3', '127.0.0.1', '100.64.0.1', '169.254.169.254',
            '172.16.0.1', '172.31.255.255', '192.168.1.1', '198.18.0.1', '224.0.0.1',
        ]) {
            expect(isPrivateAddress(address)).toBe(true);
        }
    });

    it('lets a public one through', () => {
        for (const address of ['1.1.1.1', '8.8.8.8', '104.16.0.1', '172.32.0.1', '100.63.255.255']) {
            expect(isPrivateAddress(address)).toBe(false);
        }
    });

    it('names loopback and unique-local IPv6', () => {
        for (const address of ['::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', 'ff02::1']) {
            expect(isPrivateAddress(address)).toBe(true);
        }
    });

    it('sees through an IPv4 address wearing an IPv6 prefix', () => {
        // The classic bypass: refused by shape rather than by what it maps to,
        // ::ffff:127.0.0.1 reaches the machine's own loopback.
        expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
        expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
    });

    it('lets a public IPv6 address through', () => {
        expect(isPrivateAddress('2606:4700::1111')).toBe(false);
    });

    it('refuses anything that is not an address at all', () => {
        // Everything downstream assumes this answered about an address.
        expect(isPrivateAddress('example.com')).toBe(true);
        expect(isPrivateAddress('')).toBe(true);
    });
});

describe('the URLs a server will fetch for a connector', () => {
    it('fetches an https URL on a public host', async () => {
        const url = await readReachableUrl('https://api.kucoin.com/api/v2/symbols', resolveTo('104.16.0.1'));

        expect(url).toBe('https://api.kucoin.com/api/v2/symbols');
    });

    it('refuses anything but https', async () => {
        await expect(readReachableUrl('http://api.kucoin.com/', resolveTo('104.16.0.1')))
            .rejects.toThrow(VenueRefusedError);
        await expect(readReachableUrl('file:///etc/passwd', resolveTo('104.16.0.1')))
            .rejects.toThrow(/Only https/);
    });

    it('refuses a port other than the one the scheme is served on', async () => {
        await expect(readReachableUrl('https://api.kucoin.com:8080/', resolveTo('104.16.0.1')))
            .rejects.toThrow(/port 443/);
    });

    it('refuses a URL carrying credentials', async () => {
        await expect(readReachableUrl('https://user:secret@api.kucoin.com/', resolveTo('104.16.0.1')))
            .rejects.toThrow(/credentials/);
    });

    it('refuses a name that points at the machine itself', async () => {
        await expect(readReachableUrl('https://localhost/', resolveTo('127.0.0.1')))
            .rejects.toThrow(/will not reach/);
    });

    it('refuses a public name pointed at a private address', async () => {
        // The whole reason names are resolved rather than pattern-matched: this
        // is one DNS record away from reaching anything on the server's network.
        await expect(readReachableUrl('https://totally-public.example.com/', resolveTo('169.254.169.254')))
            .rejects.toThrow(/will not reach/);
    });

    it('refuses a name that answers with one public address and one private', async () => {
        await expect(readReachableUrl('https://mixed.example.com/', resolveTo('104.16.0.1', '10.0.0.5')))
            .rejects.toThrow(/will not reach/);
    });

    it('refuses a bare private address, with or without brackets', async () => {
        await expect(readReachableUrl('https://10.0.0.1/', resolveNothing)).rejects.toThrow(/will not reach/);
        await expect(readReachableUrl('https://[::1]/', resolveNothing)).rejects.toThrow(/will not reach/);
    });

    it('refuses a host that does not resolve', async () => {
        await expect(readReachableUrl('https://nowhere.invalid/', resolveNothing))
            .rejects.toThrow(/does not resolve/);
    });

    it('refuses something that is not a URL', async () => {
        await expect(readReachableUrl('wherever', resolveTo('1.1.1.1'))).rejects.toThrow(/not a URL/);
    });
});
