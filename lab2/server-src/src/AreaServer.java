import com.fastcgi.FCGIInterface;
import com.fastcgi.FCGIRequest;

import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.math.BigDecimal;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * FastCGI-сервер лабораторной №2.
 * Определяет попадание точки (X, Y) в область при заданном R.
 *
 * Область (вариант):
 *  - II четверть: четверть круга радиуса R/2 с центром в начале координат;
 *  - I  четверть: треугольник (0,0), (R,0), (0,R);
 *  - IV четверть: прямоугольник 0 <= x <= R, -R <= y <= 0.
 *
 * X: целое из {-4..4}, Y: число из [-3; 5], R: целое из {1..5}.
 *
 * GET  — вернуть историю проверок текущей сессии;
 * POST — x, y, r: проверить точку; action=clear: очистить историю.
 */
public class AreaServer {

    // В httpd.conf стоит опция -nph (non-parsed headers): Apache отдаёт ответ
    // приложения как есть, поэтому первой строкой должна идти строка статуса
    // "HTTP/1.1 200 OK". Если запустить сервер с -DNPH=false (и убрать -nph в
    // httpd.conf), вместо неё будет заголовок "Status: 200 OK".
    private static final boolean NPH = !"false".equalsIgnoreCase(System.getProperty("NPH"));
    private static final String PROTOCOL = "HTTP/1.1";

    private static final int MAX_BODY_BYTES = 8192;
    private static final int MAX_NUMBER_LENGTH = 1000;
    private static final int MAX_HISTORY_PER_SESSION = 200;
    private static final int MAX_SESSIONS = 5000;

    private static final int X_MIN = -4;
    private static final int X_MAX = 4;
    private static final BigDecimal Y_MIN = new BigDecimal("-3");
    private static final BigDecimal Y_MAX = new BigDecimal("5");
    private static final int R_MIN = 1;
    private static final int R_MAX = 5;

    private static final Pattern INT_PATTERN = Pattern.compile("^-?\\d{1,3}$");
    private static final Pattern DECIMAL_PATTERN = Pattern.compile("^-?\\d+(\\.\\d+)?$");
    private static final Pattern SID_PATTERN = Pattern.compile("^[0-9a-f]{32}$");

    private static final SecureRandom RANDOM = new SecureRandom();

    /** История проверок по идентификаторам сессий (cookie sid). */
    private static final Map<String, List<Record>> SESSIONS =
            Collections.synchronizedMap(new LinkedHashMap<String, List<Record>>(16, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, List<Record>> eldest) {
                    return size() > MAX_SESSIONS;
                }
            });

    /** Одна выполненная проверка. */
    private static final class Record {
        final String x;
        final String y;
        final String r;
        final boolean hit;
        final long timestampMs;
        final double execMs;

        Record(String x, String y, String r, boolean hit, long timestampMs, double execMs) {
            this.x = x;
            this.y = y;
            this.r = r;
            this.hit = hit;
            this.timestampMs = timestampMs;
            this.execMs = execMs;
        }
    }

    /** Ошибка валидации входных данных (ответ 400/405/413). */
    private static final class HttpError extends Exception {
        final int status;

        HttpError(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    public static void main(String[] args) {
        FCGIInterface fcgi = new FCGIInterface();
        while (fcgi.FCGIaccept() >= 0) {
            long startNanos = System.nanoTime();
            byte[] response;
            try {
                response = handle(FCGIInterface.request, startNanos);
            } catch (HttpError e) {
                response = buildResponse(e.status, errorJson(e.getMessage(), startNanos), null, e.status == 405);
            } catch (Throwable t) {
                t.printStackTrace();
                response = buildResponse(500, errorJson("Внутренняя ошибка сервера", startNanos), null, false);
            }
            try {
                FCGIInterface.request.outStream.write(response);
                FCGIInterface.request.outStream.flush();
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    // ------------------------------------------------------------------
    // Обработка запроса
    // ------------------------------------------------------------------

    private static byte[] handle(FCGIRequest request, long startNanos) throws HttpError, IOException {
        String method = request.params.getProperty("REQUEST_METHOD", "");

        // Сессия: идентификатор берём из cookie, при отсутствии создаём новый.
        String sid = readSid(request.params.getProperty("HTTP_COOKIE"));
        boolean newSession = false;
        if (sid == null) {
            sid = newSid();
            newSession = true;
        }
        List<Record> history = historyOf(sid);
        String setCookie = newSession
                ? "sid=" + sid + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                : null;

        if ("GET".equals(method)) {
            return buildResponse(200, okJson(null, history, startNanos), setCookie, false);
        }

        if ("POST".equals(method)) {
            Map<String, String> params = parseForm(readBody(request));

            if ("clear".equals(params.get("action"))) {
                synchronized (history) {
                    history.clear();
                }
                return buildResponse(200, okJson(null, history, startNanos), setCookie, false);
            }

            int x = parseX(params.get("x"));
            BigDecimal y = parseY(params.get("y"));
            int r = parseR(params.get("r"));

            boolean hit = isHit(x, y, r);
            long now = System.currentTimeMillis();
            double execMs = elapsedMs(startNanos);

            Record record = new Record(
                    Integer.toString(x),
                    normalizeDecimalText(params.get("y")),
                    Integer.toString(r),
                    hit, now, execMs);

            synchronized (history) {
                history.add(record);
                while (history.size() > MAX_HISTORY_PER_SESSION) {
                    history.remove(0);
                }
            }
            return buildResponse(200, okJson(record, history, startNanos), setCookie, false);
        }

        throw new HttpError(405, "Метод " + method + " не поддерживается. Используйте GET или POST.");
    }

    // ------------------------------------------------------------------
    // Валидация
    // ------------------------------------------------------------------

    private static int parseX(String raw) throws HttpError {
        if (raw == null || raw.trim().isEmpty()) {
            throw new HttpError(400, "Не передан параметр x");
        }
        String s = raw.trim();
        if (!INT_PATTERN.matcher(s).matches()) {
            throw new HttpError(400, "X должен быть целым числом от " + X_MIN + " до " + X_MAX);
        }
        int value = Integer.parseInt(s);
        if (value < X_MIN || value > X_MAX) {
            throw new HttpError(400, "X должен быть в диапазоне от " + X_MIN + " до " + X_MAX);
        }
        return value;
    }

    private static BigDecimal parseY(String raw) throws HttpError {
        if (raw == null || raw.trim().isEmpty()) {
            throw new HttpError(400, "Не передан параметр y");
        }
        String s = normalizeDecimalText(raw);
        if (s.length() > MAX_NUMBER_LENGTH) {
            throw new HttpError(400, "Значение Y слишком длинное");
        }
        if (!DECIMAL_PATTERN.matcher(s).matches()) {
            throw new HttpError(400, "Y должен быть числом");
        }
        BigDecimal value = new BigDecimal(s);
        if (value.compareTo(Y_MIN) < 0 || value.compareTo(Y_MAX) > 0) {
            throw new HttpError(400, "Y должен быть в диапазоне от " + Y_MIN + " до " + Y_MAX);
        }
        return value;
    }

    private static int parseR(String raw) throws HttpError {
        if (raw == null || raw.trim().isEmpty()) {
            throw new HttpError(400, "Не передан параметр r");
        }
        String s = raw.trim();
        if (!INT_PATTERN.matcher(s).matches()) {
            throw new HttpError(400, "R должен быть целым числом от " + R_MIN + " до " + R_MAX);
        }
        int value = Integer.parseInt(s);
        if (value < R_MIN || value > R_MAX) {
            throw new HttpError(400, "R должен быть в диапазоне от " + R_MIN + " до " + R_MAX);
        }
        return value;
    }

    /** Убирает пробелы по краям и заменяет запятую на точку. */
    private static String normalizeDecimalText(String raw) {
        return raw == null ? "" : raw.trim().replace(',', '.');
    }

    // ------------------------------------------------------------------
    // Проверка попадания (точная арифметика на BigDecimal, без double)
    // ------------------------------------------------------------------

    static boolean isHit(int x, BigDecimal y, int r) {
        BigDecimal bx = BigDecimal.valueOf(x);
        BigDecimal br = BigDecimal.valueOf(r);
        int ySign = y.signum();

        // I четверть: треугольник (0,0), (R,0), (0,R): x >= 0, y >= 0, x + y <= R
        if (x >= 0 && ySign >= 0 && bx.add(y).compareTo(br) <= 0) {
            return true;
        }

        // IV четверть: прямоугольник 0 <= x <= R, -R <= y <= 0
        if (x >= 0 && x <= r && ySign <= 0 && y.compareTo(br.negate()) >= 0) {
            return true;
        }

        // II четверть: четверть круга радиуса R/2: x <= 0, y >= 0, x^2 + y^2 <= (R/2)^2,
        // то же самое, что 4(x^2 + y^2) <= R^2 (без деления)
        if (x <= 0 && ySign >= 0) {
            BigDecimal sum = bx.multiply(bx).add(y.multiply(y)).multiply(BigDecimal.valueOf(4));
            return sum.compareTo(br.multiply(br)) <= 0;
        }

        return false;
    }

    // ------------------------------------------------------------------
    // Разбор запроса
    // ------------------------------------------------------------------

    private static String readBody(FCGIRequest request) throws HttpError, IOException {
        String lengthText = request.params.getProperty("CONTENT_LENGTH");
        int length;
        try {
            length = lengthText == null || lengthText.isEmpty() ? 0 : Integer.parseInt(lengthText.trim());
        } catch (NumberFormatException e) {
            throw new HttpError(400, "Некорректный заголовок Content-Length");
        }
        if (length <= 0) {
            throw new HttpError(400, "Пустое тело запроса");
        }
        if (length > MAX_BODY_BYTES) {
            throw new HttpError(413, "Слишком большое тело запроса");
        }
        byte[] buffer = new byte[length];
        int offset = 0;
        while (offset < length) {
            int n = request.inStream.read(buffer, offset, length - offset);
            if (n < 0) {
                break;
            }
            offset += n;
        }
        return new String(buffer, 0, offset, StandardCharsets.UTF_8);
    }

    private static Map<String, String> parseForm(String body) throws HttpError {
        Map<String, String> result = new HashMap<>();
        for (String pair : body.split("&")) {
            if (pair.isEmpty()) {
                continue;
            }
            int eq = pair.indexOf('=');
            String key = eq < 0 ? pair : pair.substring(0, eq);
            String value = eq < 0 ? "" : pair.substring(eq + 1);
            try {
                key = URLDecoder.decode(key, "UTF-8");
                value = URLDecoder.decode(value, "UTF-8");
            } catch (UnsupportedEncodingException | IllegalArgumentException e) {
                throw new HttpError(400, "Некорректное кодирование параметров");
            }
            if (!result.containsKey(key)) {
                result.put(key, value);
            }
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Сессии
    // ------------------------------------------------------------------

    private static String readSid(String cookieHeader) {
        if (cookieHeader == null) {
            return null;
        }
        for (String part : cookieHeader.split(";")) {
            String p = part.trim();
            if (p.startsWith("sid=")) {
                String value = p.substring(4);
                Matcher m = SID_PATTERN.matcher(value);
                if (m.matches()) {
                    return value;
                }
            }
        }
        return null;
    }

    private static String newSid() {
        byte[] bytes = new byte[16];
        RANDOM.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(32);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }

    private static List<Record> historyOf(String sid) {
        synchronized (SESSIONS) {
            List<Record> list = SESSIONS.get(sid);
            if (list == null) {
                list = new ArrayList<>();
                SESSIONS.put(sid, list);
            }
            return list;
        }
    }

    // ------------------------------------------------------------------
    // Формирование ответа
    // ------------------------------------------------------------------

    private static double elapsedMs(long startNanos) {
        return (System.nanoTime() - startNanos) / 1_000_000.0;
    }

    private static String formatMs(double ms) {
        return String.format(Locale.ROOT, "%.3f", ms);
    }

    private static String okJson(Record current, List<Record> history, long startNanos) {
        long now = System.currentTimeMillis();
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\"status\":\"ok\"");
        sb.append(",\"serverTime\":").append(now);
        sb.append(",\"serverTimeIso\":\"").append(Instant.ofEpochMilli(now)).append('"');
        sb.append(",\"execTimeMs\":").append(formatMs(elapsedMs(startNanos)));
        if (current != null) {
            sb.append(",\"result\":");
            appendRecord(sb, current);
        }
        sb.append(",\"history\":[");
        synchronized (history) {
            for (int i = 0; i < history.size(); i++) {
                if (i > 0) {
                    sb.append(',');
                }
                appendRecord(sb, history.get(i));
            }
        }
        sb.append("]}");
        return sb.toString();
    }

    private static void appendRecord(StringBuilder sb, Record r) {
        sb.append("{\"x\":\"").append(jsonEscape(r.x)).append('"');
        sb.append(",\"y\":\"").append(jsonEscape(r.y)).append('"');
        sb.append(",\"r\":\"").append(jsonEscape(r.r)).append('"');
        sb.append(",\"hit\":").append(r.hit);
        sb.append(",\"timestamp\":").append(r.timestampMs);
        sb.append(",\"execTimeMs\":").append(formatMs(r.execMs));
        sb.append('}');
    }

    private static String errorJson(String message, long startNanos) {
        long now = System.currentTimeMillis();
        return "{\"status\":\"error\",\"message\":\"" + jsonEscape(message) + "\""
                + ",\"serverTime\":" + now
                + ",\"execTimeMs\":" + formatMs(elapsedMs(startNanos)) + "}";
    }

    private static String jsonEscape(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 8);
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"':
                    sb.append("\\\"");
                    break;
                case '\\':
                    sb.append("\\\\");
                    break;
                case '\n':
                    sb.append("\\n");
                    break;
                case '\r':
                    sb.append("\\r");
                    break;
                case '\t':
                    sb.append("\\t");
                    break;
                default:
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
            }
        }
        return sb.toString();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 405: return "Method Not Allowed";
            case 413: return "Payload Too Large";
            default: return "Internal Server Error";
        }
    }

    private static byte[] buildResponse(int status, String json, String setCookie, boolean addAllow) {
        byte[] body = json.getBytes(StandardCharsets.UTF_8);
        StringBuilder head = new StringBuilder();
        if (NPH) {
            head.append(PROTOCOL).append(' ').append(status).append(' ').append(reason(status)).append("\r\n");
        } else {
            head.append("Status: ").append(status).append(' ').append(reason(status)).append("\r\n");
        }
        head.append("Date: ")
                .append(DateTimeFormatter.RFC_1123_DATE_TIME.format(ZonedDateTime.now(ZoneOffset.UTC)))
                .append("\r\n");
        head.append("Content-Type: application/json; charset=UTF-8\r\n");
        head.append("Content-Length: ").append(body.length).append("\r\n");
        head.append("Cache-Control: no-store\r\n");
        if (addAllow) {
            head.append("Allow: GET, POST\r\n");
        }
        if (setCookie != null) {
            head.append("Set-Cookie: ").append(setCookie).append("\r\n");
        }
        head.append("\r\n");

        byte[] headBytes = head.toString().getBytes(StandardCharsets.UTF_8);
        byte[] all = new byte[headBytes.length + body.length];
        System.arraycopy(headBytes, 0, all, 0, headBytes.length);
        System.arraycopy(body, 0, all, headBytes.length, body.length);
        return all;
    }
}
