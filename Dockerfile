FROM python:3.10

# Create a non-root user (Hugging Face default recommendation)
RUN useradd -m -u 1000 user
USER user
ENV PATH="/home/user/.local/bin:$PATH"

WORKDIR /app

# Copy requirements file
COPY --chown=user ./requirements.txt requirements.txt

# Install dependencies
RUN pip install --no-cache-dir --upgrade -r requirements.txt

# Copy the rest of the application
COPY --chown=user . /app

# Run the application
# Note: Hugging Face Spaces expect port 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
