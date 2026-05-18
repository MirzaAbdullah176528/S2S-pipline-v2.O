import collections
import random
import threading
import time


class GeminiRateLimiter:
    def __init__(self, rpm_limit: int = 14):
        self._lock         = threading.Lock()
        self._calls: collections.deque = collections.deque(maxlen=rpm_limit + 10)
        self._min_interval = 60.0 / rpm_limit
        self._rpm_limit    = rpm_limit

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()

            window = sum(1 for ts in self._calls if now - ts < 60.0)

            if window >= self._rpm_limit:
                oldest_in_window = min((ts for ts in self._calls if now - ts < 60.0), default=now - 999)
                sleep_needed = max(0.0, 62.0 - (now - oldest_in_window))
                time.sleep(sleep_needed)
            else:
                if self._calls:
                    elapsed = now - self._calls[-1]
                    gap     = self._min_interval - elapsed + random.uniform(0.0, 0.5)
                    if gap > 0.0:
                        time.sleep(gap)

            self._calls.append(time.monotonic())

    def __call__(self):
        self.acquire()
