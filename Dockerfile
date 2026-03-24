FROM python:3.12-slim

# Install cron + tzdata (for America/New_York cron schedule)
RUN apt-get update \
    && apt-get install -y --no-install-recommends cron tzdata \
    && rm -rf /var/lib/apt/lists/*

ENV TZ=America/New_York
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pre-create cache dir
RUN mkdir -p cache

# Cron: refresh data at 2 AM Eastern every day
RUN printf '0 2 * * * cd /app && python main.py --refresh-cache >> /var/log/storehouse-cron.log 2>&1\n' \
    > /etc/cron.d/storehouse-refresh \
    && chmod 0644 /etc/cron.d/storehouse-refresh \
    && crontab /etc/cron.d/storehouse-refresh

RUN chmod +x entrypoint.sh

EXPOSE 8765

CMD ["./entrypoint.sh"]
