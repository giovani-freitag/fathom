import type { Locale } from '../i18n/locale.ts';
import type { ReactElement } from 'react';

interface FlagIconProps {
    readonly locale: Locale;
    readonly className?: string;
}

/**
 * The flag of the country a language is offered under, cropped to a disc.
 */
export function FlagIcon({ locale, className = 'size-[18px]' }: FlagIconProps): ReactElement {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden
            className={`${className} shrink-0 rounded-full ring-1 ring-inset ring-black/25`}
        >
            <defs>
                <clipPath id={`flag-disc-${locale}`}>
                    <circle cx="12" cy="12" r="12" />
                </clipPath>
            </defs>
            <g clipPath={`url(#flag-disc-${locale})`}>
                {locale === 'pt-BR' ? <BrazilField /> : <UnitedStatesField />}
            </g>
        </svg>
    );
}

function BrazilField(): ReactElement {
    return (
        <>
            <rect width="24" height="24" fill="#009b3a" />
            <path d="M12 3.4 21.4 12 12 20.6 2.6 12Z" fill="#fedf00" />
            <circle cx="12" cy="12" r="4.1" fill="#002776" />
            <path
                d="M8.1 10.6c2.6-.7 5.5-.3 7.7 1.1"
                fill="none"
                stroke="#ffffff"
                strokeWidth="1.1"
            />
        </>
    );
}

const STAR_ROWS_Y = [2.2, 5, 7.8];
const STAR_COLUMNS_X = [1.8, 4.4, 7, 9.6];

function UnitedStatesField(): ReactElement {
    return (
        <>
            <rect width="24" height="24" fill="#ffffff" />
            {[0, 2, 4, 6, 8, 10, 12].map((offset) => (
                <rect key={offset} y={offset * (24 / 13)} width="24" height={24 / 13} fill="#b22234" />
            ))}
            <rect width="11" height={24 / 13 * 7} fill="#3c3b6e" />
            {STAR_ROWS_Y.flatMap((y) => STAR_COLUMNS_X.map((x) => (
                <circle key={`${y}-${x}`} cx={x} cy={y} r="0.62" fill="#ffffff" />
            )))}
        </>
    );
}
