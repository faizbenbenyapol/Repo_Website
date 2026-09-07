import { greet } from './greet';
import { formatName } from './util/format';

export function main(): string {
  return greet(formatName('โลก'));
}
