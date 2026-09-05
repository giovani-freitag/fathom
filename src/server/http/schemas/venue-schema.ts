import { Type } from '@sinclair/typebox';

/** Long enough for a venue endpoint carrying its whole query. */
const MAXIMUM_URL_LENGTH = 2_048;

export const VenueFiltersSchema = Type.Object({
    url: Type.String({ minLength: 1, maxLength: MAXIMUM_URL_LENGTH }),
});

export const VenueRouteSchema = {
    querystring: VenueFiltersSchema,
};
