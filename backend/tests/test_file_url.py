"""C35.8a (issue 19): one signed URL per book file, reused while it has long enough to live."""

import pytest

from backend.agents import policy
from backend.services import file_url


class Bucket:
    def __init__(self, answer=None):
        self.signed = []
        self.answer = answer

    def create_signed_url(self, path, expires_in):
        self.signed.append((path, expires_in))
        if self.answer is not None:
            return self.answer
        url = f"https://s/sign/{path}?n={len(self.signed)}"
        return {"signedURL": url}


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def test_the_same_url_is_handed_out_while_it_lives_long_enough():
    bucket, clock = Bucket(), Clock()
    url, left = file_url.signed_url(bucket, "u/b.pdf", now=clock)
    assert left == policy.BOOK_FILE_URL_SECONDS
    clock.t += policy.BOOK_FILE_URL_SECONDS - policy.BOOK_FILE_URL_MIN_LEFT  # just long enough left
    assert file_url.signed_url(bucket, "u/b.pdf", now=clock) == (url, policy.BOOK_FILE_URL_MIN_LEFT)
    assert bucket.signed == [("u/b.pdf", policy.BOOK_FILE_URL_SECONDS)]


def test_a_url_with_too_little_left_is_replaced():
    bucket, clock = Bucket(), Clock()
    first, _ = file_url.signed_url(bucket, "u/b.pdf", now=clock)
    clock.t += policy.BOOK_FILE_URL_SECONDS - policy.BOOK_FILE_URL_MIN_LEFT + 1
    second, left = file_url.signed_url(bucket, "u/b.pdf", now=clock)
    assert second != first and left == policy.BOOK_FILE_URL_SECONDS and len(bucket.signed) == 2


def test_each_file_has_its_own_url():
    bucket = Bucket()
    a, _ = file_url.signed_url(bucket, "u/a.pdf")
    b, _ = file_url.signed_url(bucket, "u/b.pdf")
    assert a != b and [path for path, _ in bucket.signed] == ["u/a.pdf", "u/b.pdf"]


def test_a_forgotten_file_is_signed_afresh():
    bucket = Bucket()
    first, _ = file_url.signed_url(bucket, "u/b.pdf")
    file_url.forget("u/b.pdf")
    assert file_url.signed_url(bucket, "u/b.pdf")[0] != first


def test_old_urls_are_not_kept():
    bucket, clock = Bucket(), Clock()
    file_url.signed_url(bucket, "u/old.pdf", now=clock)
    clock.t += policy.BOOK_FILE_URL_SECONDS
    file_url.signed_url(bucket, "u/new.pdf", now=clock)
    assert list(file_url._kept) == ["u/new.pdf"]


def test_storage_without_a_url_is_an_error_and_nothing_is_kept():
    with pytest.raises(RuntimeError):
        file_url.signed_url(Bucket(answer={"error": "nope"}), "u/b.pdf")
    assert file_url._kept == {}
