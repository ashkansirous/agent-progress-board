const HTTP_URL = /^https?:\/\//i;

/** True only for an http or https URL: the one rule for every link the page renders. */
export function isSafeHttpUrl(url: string | undefined): url is string {
  return url !== undefined && HTTP_URL.test(url);
}
