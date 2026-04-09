FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (cached unless pyproject.toml changes)
COPY pyproject.toml ./
RUN pip install --no-cache-dir -q -U pip \
    && pip install --no-cache-dir -q $(python3 -c "import tomllib; print(' '.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))")

# Copy source
COPY . /app
RUN addgroup --system app && adduser --system --ingroup app app \
    && chown -R app:app /app

USER app
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
