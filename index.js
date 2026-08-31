require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');

const mining = require('./mining');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 🕒 한국 시간(KST) 헬퍼 함수
function getKSTInfo() {
    const now = new Date();
    const todayStr = now.toLocaleDateString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).replace(/\. /g, '-').replace('.', '');

    const hourStr = now.toLocaleTimeString('ko-KR', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        hour12: false
    });
    const currentHour = parseInt(hourStr, 10);

    return { today: todayStr, currentHour, nativeDate: now };
}

function getRemindMessage(hour) {
    if (hour === 11) return "좋은 아침이에요! 오늘도 잊지 말고 출근 도장 꾹 눌러주세요? ✨";
    if (hour === 14) return "벌써 오후 2시에요! 설마 오늘 출근 까먹으신 건 아니죠...? 얼른 오세요! 🤨";
    if (hour === 17) return "이제 해가 지려고 해요... 오늘 출근 안 하시면 연속 기록이 깨질지도 몰라요. 제발 와주세요. 😭";
    if (hour === 18) return "저기요... 아직도 안 오신 건가요? 6시예요. 이제 슬슬 걱정되기 시작하네요. 😟";
    if (hour === 19) return "7시입니다. 당신의 연속 출근 기록이 공중분해 되기 직전이에요. 지금 당장 오세요! ⚡";
    if (hour === 20) return "8시... 이제 제 목소리가 들리지 않나요? 당신의 성실함이 시험받고 있어요. ✊";
    if (hour === 21) return "9시예요. 이대로 포기하실 건가요? 지금까지 쌓아온 노력이 아깝지 않으세요? 😠";
    if (hour === 22) return "10시입니다. 이제 시간이 얼마 없어요. 제발... 마지막 기회일지도 몰라요. 🙏";
    if (hour === 23) return "11시!!! 이제 한 시간 뒤면 모든 게 끝납니다. 죽기 살기로 출근하세요! 빨리!!! 🚨🚨";
    return null;
}

// 🛡️ 대리 출근 로직
async function runJaewonAttendance() {
    const { today } = getKSTInfo();
    const JAEWON_ID = "1152202483666538516";
    const JAEWON_NAME = "smphur08";

    const { data: user, error: selectError } = await supabase
        .from('attendance')
        .select('*')
        .eq('user_id', JAEWON_ID)
        .maybeSingle();

    if (selectError) throw selectError;

    if (user && user.last_checkin === today) {
        return { success: false, status: "ALREADY", reason: "이미 오늘 출근 처리가 되어 있습니다.", streak: user.streak };
    }

    let currentTokens = user ? (user.tokens ?? 200) : 200;
    if (currentTokens < 10) {
        return { success: false, status: "NO_TOKEN", reason: "보유 토큰이 부족합니다. (대리 출근에는 10 토큰이 필요합니다.)", streak: user ? user.streak : 0 };
    }

    currentTokens -= 10;

    let newStreak = 1;
    if (user && user.last_checkin) {
        const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
        const parts = formatter.formatToParts(new Date());
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const d = parts.find(p => p.type === 'day').value;
        
        const yesterday = new Date(`${y}-${m}-${d}T12:00:00+09:00`);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        if (user.last_checkin === yesterdayStr) {
            newStreak = (user.streak || 0) + 1;
        }
    }

    const currentCards = user ? (user.protection_cards ?? 0) : 0;

    const { error: upsertError } = await supabase.from('attendance').upsert({
        user_id: JAEWON_ID,
        username: JAEWON_NAME,
        last_checkin: today,
        streak: newStreak,
        tokens: currentTokens,
        protection_cards: currentCards
    }, { onConflict: 'user_id' });

    if (upsertError) throw upsertError;

    return { success: true, streak: newStreak, remainingTokens: currentTokens };
}

// 🎰 자산 정산 및 확률 관리 엔진
async function applySlotWinnings(message, userId, user, slotPrice, prize, resultText, slotDisplay, curseType = null) {
    let currentP444 = user.p_444 ?? 4.0;
    let currentP666 = user.p_666 ?? 1.0;

    let newP444 = currentP444;
    let newP666 = currentP666;

    if (curseType === '444') {
        newP444 = 4.0;
    } else if (curseType === '666') {
        newP666 = 1.0;
    } else if (prize > slotPrice) { 
        newP444 = Math.min(currentP444 + 0.4, 99.0);
        newP666 = Math.min(currentP666 + 0.5, 99.0);
    }

    if (newP444 > currentP444 && Math.floor(currentP444 / 10) < Math.floor(newP444 / 10)) {
        try { await message.author.send(`⚠️ **[개인 경고]** 슬롯머신 수익 누적으로 인해 **444 사(死)의 저주 확률**이 **${Math.floor(newP444)}%**를 돌파했습니다!`); } catch (e) {}
    }
    if (newP666 > currentP666 && Math.floor(currentP666 / 10) < Math.floor(newP666 / 10)) {
        try { await message.author.send(`💀 **[개인 극비 경고]** 심연의 존재가 주시합니다. **666 지옥의 저주 확률**이 **${Math.floor(newP666)}%**를 돌파했습니다!`); } catch (e) {}
    }

    let startTokens = user.tokens ?? 200;
    let finalTokens = startTokens - slotPrice + prize;

    if (finalTokens < 0) finalTokens = 0;
    finalTokens = Math.floor(finalTokens); // INTEGER 소수점 컷

    const { error: upsertError } = await supabase.from('attendance').upsert({
        user_id: userId,
        username: message.author.username,
        tokens: finalTokens,
        protection_cards: user.protection_cards ?? 0,
        streak: user.streak ?? 0,
        last_checkin: user.last_checkin ?? null,
        p_444: newP444,
        p_666: newP666
    }, { onConflict: 'user_id' });

    if (upsertError) {
        console.error("❌ 슬롯 결과 DB 반영 에러 발생:", upsertError);
        return message.reply(`❌ **[시스템 에러] 데이터베이스 저장에 실패했습니다.**`);
    }

    let displayPrize = prize >= 0 ? `+${prize} 토큰` : `${prize} 토큰`;

    return message.reply(
        `🎰 **SLOT MACHINE** 🎰\n` +
        `${slotDisplay}\n` +
        `-------------------------\n` +
        `${resultText}\n` +
        `💸 **판돈 차감:** [ -${slotPrice} 토큰 ]\n` +
        `🎁 **당첨 보상:** [ ${displayPrize} ]\n` +
        `💳 **현재 잔액:** ${finalTokens} 토큰 (나의 444: ${newP444.toFixed(1)}% | 나의 666: ${newP666.toFixed(1)}%)`
    );
}

client.once('ready', () => {
    console.log(`✅ 봇 로그인 성공: ${client.user.tag}`);

    cron.schedule('0 23 * * *', async () => {
        try {
            const result = await runJaewonAttendance();
            if (result.success) console.log(`✨ [자동완료] 23시 대리 출근 성공!`);
        } catch (err) { console.error(err); }
    }, { timezone: "Asia/Seoul" });

    cron.schedule('0 * * * *', async () => {
        const { today, currentHour } = getKSTInfo();
        const messageText = getRemindMessage(currentHour);
        if (messageText) {
            const { data: allUsers } = await supabase.from('attendance').select('*');
            if (allUsers) {
                for (const user of allUsers) {
                    if (user.last_checkin !== today) {
                        try {
                            const discordUser = await client.users.fetch(user.user_id);
                            await discordUser.send(`🔔 <@${user.user_id}>님! ${messageText}`);
                        } catch (err) {}
                    }
                }
            }
        }
    }, { timezone: "Asia/Seoul" });

    cron.schedule('59 23 * * *', async () => {
        const { today } = getKSTInfo();
        const { data: allUsers } = await supabase.from('attendance').select('*');
        if (!allUsers) return;

        for (const user of allUsers) {
            if (user.last_checkin !== today && (user.streak || 0) > 0) {
                let cards = user.protection_cards || 0;
                if (cards > 0) {
                    cards -= 1;
                    await supabase.from('attendance').update({ protection_cards: cards }).eq('user_id', user.user_id);
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`🛡️ 보호권이 사용되어 기록이 유지되었습니다! (남은 보호권: ${cards}개)`);
                    } catch (e) {}
                } else {
                    await supabase.from('attendance').update({ streak: 0 }).eq('user_id', user.user_id);
                    try {
                        const discordUser = await client.users.fetch(user.user_id);
                        await discordUser.send(`💀 보호권이 없어 연속 출근 횟수가 초기화되었습니다.`);
                    } catch (e) {}
                }
            }
        }
    }, { timezone: "Asia/Seoul" });
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const userId = message.author.id;
    const { today, currentHour } = getKSTInfo();

    const commandBody = message.content.trim();
    const args = commandBody.split(' ');
    const command = args.shift();

    if (command === "!재원") {
        try {
            await message.channel.sendTyping();
            const result = await runJaewonAttendance();
            if (result.success) {
                return message.reply(`🎯 **[수동 완료]** 대리 출근 성공! (잔여: 💰 \`${result.remainingTokens} 토큰\` / 🔥 연속 ${result.streak}일)`);
            } else {
                return message.reply(`ℹ️ **[스킵]** ${result.reason}`);
            }
        } catch (err) { return message.reply("❌ DB 처리 중 에러 발생"); }
    }

    if (command === "듀오링고") {
        const testMsg = getRemindMessage(currentHour);
        const finalMsg = testMsg ? testMsg : `현재 한국 시간 ${currentHour}시입니다.`;
        try {
            await message.author.send(`🧪 **[테스트 알림]**\n🔔 <@${userId}>님! ${finalMsg}`);
            return message.reply("성공! 개인 DM 확인 고고. 📩");
        } catch (err) { return message.reply("DM 전송 실패!"); }
    }

    if (command === "!상점") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const myTokens = user ? (user.tokens ?? 200) : 200;
            const myCards = user ? (user.protection_cards ?? 0) : 0;
            return message.reply(`🛒 **토큰 상점**\n👤 보유 토큰: 💰 \`${myTokens}\` | 보유 보호권: 🛡️ \`${myCards}개\`\n📦 **🛡️ 출근 횟수 보호권** | 가격: \`100 토큰\`\n👉 구매: \`!구매\` | 환불: \`!환불\` (수수료 제외 80토큰 반환)`);
        } catch (err) { return message.reply("상점 로드 실패."); }
    }

    if (command === "!구매") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;

            if (currentTokens < 100) return message.reply(`❌ 토큰 부족! (보유: 💰 \`${currentTokens}\`)`);

            await supabase.from('attendance').upsert({
                user_id: userId, username: message.author.username,
                tokens: currentTokens - 100, protection_cards: currentCards + 1,
                streak: user ? user.streak : 0, last_checkin: user ? user.last_checkin : null
            }, { onConflict: 'user_id' });

            return message.reply(`🛒 구매 완료! (잔여: 💰 \`${currentTokens - 100}\` | 보호권: 🛡️ \`${currentCards + 1}개\`)`);
        } catch (err) { return message.reply("구매 오류."); }
    }

    if (command === "!환불") {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;
            let currentCards = user ? (user.protection_cards ?? 0) : 0;

            if (currentCards < 1) return message.reply(`❌ 환불할 보호권이 없습니다.`);

            await supabase.from('attendance').upsert({
                user_id: userId, username: message.author.username,
                tokens: currentTokens + 80, protection_cards: currentCards - 1,
                streak: user ? user.streak : 0, last_checkin: user ? user.last_checkin : null
            }, { onConflict: 'user_id' });

            return message.reply(`💸 환불 완료! 80 토큰 반환. (현재 보유: 💰 \`${currentTokens + 80}\` | 보유 보유권: 🛡️ \`${currentCards - 1}개\`)`);
        } catch (err) { return message.reply("환불 오류."); }
    }

    if (command === '!도박') {
        return message.reply(
            `🎲 **[도박 시스템 종합 가이드]** 🎲\n` +
            `원하는 도박판의 명령어를 입력하세요. (기본 판돈: 슬롯 25토큰 / 로또 수동 50, 자동 55토큰)\n\n` +
            `🎰 **슬롯머신 계열**\n` +
            `• \`!슬롯3\` : 클래식 3x1 격자 도박판\n` +
            `• \`!슬롯53\` : 5열 3행 완벽 격자 대형 도박판\n` +
            `• \`!슬롯25\` : 2열 5행 보드 카드 뒤집기 (입력: \`!1 5 8\`)\n` +
            `• \`!슬롯7\` : 7열 1행 하이리스크 초정밀 도박판 (상세 규칙 하단 참조)\n\n` +
            `🎫 **로또 복권 계열**\n` +
            `• \`!로또자동\` / \`!로또수동 번호1 번호2 ...\`\n\n` +
            `🚪 **확률 제어 시스템**\n` +
            `• \`!종료\` : 본인에게 쌓인 444, 666 저주 누적 확률 초기화\n\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `🎰 **[!슬롯7] 상세 조합 배당 가이드**\n` +
            `• 💥 **[SixSeven]** \`0\` ── 6️⃣7️⃣ 문양이 정방향으로 연속 인접할 때 당첨금 무조건 소멸 (7️⃣6️⃣은 안전)\n` +
            `• 💀 **[지옥]** \`-5000\` ── 4️⃣ 또는 6️⃣ 문양으로만 7칸 도배 (혼합 가능)\n` +
            `• 👑 **[정복자]** \`+5000\` ── 7️⃣ 도배\n` +
            `• 💎 **[억만장자]** \`+2500\` ── 💎 도배\n` +
            `• 🔢 **[넘버플러쉬]** \`+3000\` ── 숫자기호(7, 6, 4)로만 7칸 구성\n` +
            `• ✨ **[백만장자]** \`+1500\` ── 💎 5개 이상 등장\n` +
            `• 🎩 **[루팡]** \`+813\` ── 💎 정확히 3개 등장\n` +
            `• 🍗 **[더블윙치킨]** \`+700\` ── 양 끝 2칸씩 🍀 배치, 중앙 3칸 🍀 배제\n` +
            `• 🎉 **[잭팟]** \`+500\` / 👁️ **[루시퍼]** \`-1500\` / ⏳ **[사신도래]** \`-444.4\` ── 해당 문양 정확히 3개 비연속 배치\n` +
            `• 🍇 **[프룻셀러]** \`+400\` ── 과일 기호로만 7칸 구성\n` +
            `• 🔮 **[데칼코마니]** \`+353\` ── 좌우 데칼코마니 대칭 형태\n` +
            `• 🎯 **[명사수]** \`+300\` ── 중앙 3칸에 7,6,4가 중복 없이 무작위 안착\n` +
            `• 🌈 **[잡화점]** \`+200\` ── 7칸 모두 다른 문양 등장\n` +
            `• 💥 **[멀티 스트라이크]** ── 아래 미니 트리플 연속 조합이 2개 이상 중복 발생 시 **[최고 보상의 2배]** 지급\n` +
            `• 🔥 **[미니 트리플]** ── 7️⃣7️⃣7️⃣ 연속(\`+7\`) / 6️⃣6️⃣6️⃣ 연속(\`+6\`) / 4️⃣4️⃣4️⃣ 연속(\`+4\`)\n` +
            `• ◽ **[본전 환급]** \`+25\` ── 노조합 시 판돈 보존`
        );
    }

    if (command === '!종료') {
        try {
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            if (!user) return message.reply("ℹ️ 등록된 정보가 없는 신규 사용자입니다.");

            await supabase.from('attendance').update({ p_444: 4.0, p_666: 1.0 }).eq('user_id', userId);
            return message.reply(`🚪 **[세션 종료]** 저주 확률이 리셋되었습니다! (444: 4.0% | 666: 1.0%)`);
        } catch (e) { return message.reply("❌ 세션 초기화 에러 발생"); }
    }

    if (['!슬롯3', '!슬롯53', '!슬롯7'].includes(command)) {
        try {
            const slotPrice = 25;
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };
            
            if ((u.tokens ?? 200) < slotPrice) return message.reply(`❌ 토큰이 부족합니다! 판돈은 **${slotPrice} 토큰**입니다.`);

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            const generateSymbol = () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            };

            // 🎰 !슬롯3 코어
            if (command === '!슬롯3') {
                let row = Array.from({ length: 3 }, generateSymbol);
                let slotDisplay = `[ ${row.join(' | ')} ]`;

                let prize = 0;
                let curseType = null;
                let resultText = '';

                const fruitsAndBell = ['🍇', '🍊', '🍒', '🔔'];
                const numbers = ['7️⃣', '4️⃣', '6️⃣'];

                const count6 = row.filter(s => s === '6️⃣').length;
                const count4 = row.filter(s => s === '4️⃣').length;
                const uniqueSymbols = new Set(row);

                if (count6 === 3) { 
                    curseType = '666'; prize = -1500; 
                    resultText = '💀 **[3x1 루시퍼] 심연의 군주가 깨어났습니다! (-1500토큰)** 💀'; 
                } else if (count4 === 3) { 
                    curseType = '444'; prize = -444.4;
                    resultText = '👁️ **[3x1 사신 도래] 거둘 영혼이 정해졌습니다. (-444.4토큰)** 👁️'; 
                } else if (uniqueSymbols.size === 1 && row[0] === '7️⃣') { 
                    prize = 500; resultText = '👑 **[3x1 잭팟] 신화의 벽을 뚫었습니다! (+500토큰)** 👑'; 
                } else if (uniqueSymbols.size === 1 && row[0] === '💎') { 
                    prize = 300; resultText = '💎 **[3x1 트레져헌터] 고대 보물상자 개봉! (+300토큰)** 💎'; 
                } else if (row[0] === '🍀' && row[2] === '🍀') {
                    prize = 200; resultText = '🍀 **[3x1 더블윙] 양날개에 깃든 행운! (+200토큰)** 🍀';
                } else if (uniqueSymbols.size === 1) {
                    prize = 100; resultText = `🎉 **[3x1 트리플] 문양 3개 완벽 정렬! (+100토큰)** 🎉`;
                } else if (uniqueSymbols.size === 3 && row.every(s => fruitsAndBell.includes(s))) {
                    prize = 150; resultText = '🍇🍊🍒 **[3x1 푸르티 잭팟] 상큼한 과일 정원! (+150토큰)**';
                } else if (uniqueSymbols.size === 3 && row.every(s => numbers.includes(s))) {
                    prize = 65; resultText = '🔢 **[3x1 넘버 잭팟] 세 가지 숫자의 운명! (+65토큰)**';
                } else if (uniqueSymbols.size === 2) {
                    prize = 50; resultText = '🍀 **[3x1 페어] 2개의 심볼 매치! (+50토큰)**';
                } else {
                    prize = 5; resultText = '◽ **[3x1 낙첨] 소소한 위로금이 지급됩니다. (+5토큰)** ◽';
                }

                return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);
            }

            // 🎰 !슬롯7 코어
            if (command === '!슬롯7') {
                let row = Array.from({ length: 7 }, generateSymbol);
                let slotDisplay = `[ ${row.join(' | ')} ]`;
                
                const countDiamond = row.filter(s => s === '💎').length;
                const countBell = row.filter(s => s === '🔔').length;

                const checkNonConsecutive3 = (arr, symbol) => {
                    const indices = [];
                    arr.forEach((s, idx) => { if (s === symbol) indices.push(idx); });
                    if (indices.length !== 3) return false;
                    return (indices[1] - indices[0] > 1) && (indices[2] - indices[1] > 1);
                };

                // 🔍 연속 3칸 겹침 매칭 스캔 엔진
                let has777 = false;
                let has666 = false;
                let has444 = false;
                for (let i = 0; i <= 4; i++) {
                    if (row[i] === '7️⃣' && row[i+1] === '7️⃣' && row[i+2] === '7️⃣') has777 = true;
                    if (row[i] === '6️⃣' && row[i+1] === '6️⃣' && row[i+2] === '6️⃣') has666 = true;
                    if (row[i] === '4️⃣' && row[i+1] === '4️⃣' && row[i+2] === '4️⃣') has444 = true;
                }

                let matchedTypes = [];
                if (has777) matchedTypes.push({ name: '7️⃣7️⃣7️⃣ 연속', prize: 7 });
                if (has666) matchedTypes.push({ name: '6️⃣6️⃣6️⃣ 연속', prize: 6 });
                if (has444) matchedTypes.push({ name: '4️⃣4️⃣4️⃣ 연속', prize: 4 });

                let prize = 25; 
                let curseType = null;
                let resultText = '◽ **[슬롯7 본전] 아무런 패턴이 없으나 판돈을 그대로 돌려받습니다. (+25토큰 환급)**';

                const rowStr = row.join('');

                // 💥 SixSeven 크래시 판정 (최상단 위치)
                if (rowStr.includes('6️⃣7️⃣')) {
                    prize = 0;
                    resultText = '💥 **[슬롯7 SixSeven]** 6️⃣7️⃣ 연쇄 조합이 인접하여 도박판 판돈과 당첨금이 모두 소멸했습니다! (0토큰 처리)';
                }
                else if (row.every(s => s === '6️⃣') || row.every(s => s === '4️⃣' || s === '6️⃣')) {
                    prize = -5000;
                    resultText = '💀 **[슬롯7 지옥] 문이 열렸습니다. 사악한 기운이 지갑을 집어삼킵니다! (-5000토큰 소멸)** 💀';
                }
                else if (row.every(s => s === '7️⃣')) {
                    prize = 5000;
                    resultText = '👑 **[슬롯7 정복자] 신화적 확률 달성! 슬롯의 절대 지배자입니다! (+5000토큰 획득)** 👑';
                }
                else if (row.every(s => s === '💎')) {
                    prize = 2500;
                    resultText = '💎 **[슬롯7 억만장자] 순도 100%의 광채! (+2500토큰 획득)** 💎';
                }
                else if (row.every(s => ['7️⃣', '6️⃣', '4️⃣'].includes(s))) {
                    prize = 3000;
                    resultText = '🔢 **[슬롯7 넘버플러쉬] 오직 숫자로만 정렬되었습니다! (+3000토큰 획득)** 🔢';
                }
                else if (row.every(s => ['🍇', '🍊', '🍒'].includes(s))) {
                    prize = 400;
                    resultText = '🍇 **[슬롯7 프룻셀러] 달콤한 과일 향이 가득합니다. (+400토큰 획득)** 🍊';
                }
                else if (row[0] === '🍀' && row[1] === '🍀' && row[5] === '🍀' && row[6] === '🍀' && ![row[2], row[3], row[4]].includes('🍀')) {
                    prize = 700;
                    resultText = '🍗 **[슬롯7 더블윙치킨] 양 날개를 펼친 행운의 도래! (+700토큰 획득)** 🍗';
                }
                else if (row[0] === row[6] && row[1] === row[5] && row[2] === row[4]) {
                    prize = 353;
                    resultText = '🔮 **[슬롯7 데칼코마니] 거울에 비친 듯 완벽한 시각적 대칭! (+353토큰 획득)** 🔮';
                }
                else if (
                    ['7️⃣', '6️⃣', '4️⃣'].includes(row[2]) && ['7️⃣', '6️⃣', '4️⃣'].includes(row[3]) && ['7️⃣', '6️⃣', '4️⃣'].includes(row[4]) &&
                    (new Set([row[2], row[3], row[4]]).size === 3) &&
                    !['7️⃣', '6️⃣', '4️⃣'].includes(row[0]) && !['7️⃣', '6️⃣', '4️⃣'].includes(row[1]) && !['7️⃣', '6️⃣', '4️⃣'].includes(row[5]) && !['7️⃣', '6️⃣', '4️⃣'].includes(row[6])
                ) {
                    prize = 300;
                    resultText = '🎯 **[슬롯7 명사수] 과녁 정중앙에 정확히 내리꽂힌 삼색 탄환! (+300토큰 획득)** 🎯';
                }
                else if (countDiamond >= 5) {
                    prize = 1500;
                    resultText = '✨ **[슬롯7 백만장자] 가방을 가득 채운 보석 더미! (+1500토큰 획득)** ✨';
                }
                else if (countBell >= 4) {
                    prize = -29;
                    resultText = '🔔 **[슬롯7 시끄러운아침] 알람 소리에 정신이 아득해집니다. (-29토큰 소멸)** 🔔';
                }
                else if (checkNonConsecutive3(row, '7️⃣')) {
                    prize = 500;
                    resultText = '🎉 **[슬롯7 잭팟] 흩어진 행운의 번호들이 연쇄 반응을 일으킵니다! (+500토큰 획득)** 🎉';
                }
                else if (checkNonConsecutive3(row, '6️⃣')) {
                    curseType = '666'; prize = -1500;
                    resultText = '👁️ **[슬롯7 루시퍼] 은밀하게 배치된 낙인이 시야를 가립니다. (-1500토큰 소멸)** 👁️';
                }
                else if (checkNonConsecutive3(row, '4️⃣')) {
                    curseType = '444'; prize = -444.4;
                    resultText = '⏳ **[슬롯7 사신의 도래] 불길한 숫자가 당신의 뒤편에 나열됩니다. (-444.4토큰 소멸)** ⏳';
                }
                else if (countDiamond === 3) {
                    prize = 813;
                    resultText = '🎩 **[슬롯7 루팡] 예고장대로 삼색 보석을 훔쳐냅니다. (+813토큰 획득)** 🎩';
                }
                else if (new Set(row).size === 7) {
                    prize = 200;
                    resultText = '🌈 **[슬롯7 잡화점] 단 하나도 겹치지 않는 기묘한 수집품들! (+200토큰 획득)** 🌈';
                }
                // 🔥 연속 조합 복합 판정 단락 (중복 시 최고 배당의 2배 적용)
                else if (matchedTypes.length >= 2) {
                    let maxPrize = Math.max(...matchedTypes.map(t => t.prize));
                    prize = maxPrize * 2;
                    resultText = `💥 **[슬롯7 멀티 스트라이크]** 두 개 이상의 연속 조합 유형이 겹쳤습니다! 최고 보상(${maxPrize}토큰)의 2배가 적용됩니다. (+${prize}토큰 획득)`;
                }
                else if (matchedTypes.length === 1) {
                    prize = matchedTypes[0].prize;
                    resultText = `🔥 **[슬롯7 미니 트리플]** 연속 배치 성공! [${matchedTypes[0].name}] 패턴 보상이 지급됩니다. (+${prize}토큰 획득)`;
                }

                return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);
            }

            // 🎰 !슬롯53 코어
            if (command === '!슬롯53') {
                let matrix = [];
                let slotDisplay = '';
                for (let i = 0; i < 3; i++) {
                    let row = Array.from({ length: 5 }, generateSymbol);
                    matrix.push(row);
                    slotDisplay += `[ ${row.join(' | ')} ]\n`;
                }

                let prize = 0;
                let curseType = null;
                let resultText = '';
                
                let allSymbols = matrix.flat();
                const total6 = allSymbols.filter(s => s === '6️⃣').length;
                const total4 = allSymbols.filter(s => s === '4️⃣').length;

                const row1Set = new Set(matrix[0]);
                const row2Set = new Set(matrix[1]);
                const row3Set = new Set(matrix[2]);

                if (total6 >= 5) {
                    curseType = '666'; prize = -1500;
                    resultText = '💀☠️ **[5x3 대재앙] 지옥의 숫자로 오염되었습니다! 1500토큰 소멸!** ☠️💀';
                } else if (total4 >= 6) {
                    curseType = '444'; prize = -444.4;
                    resultText = '👁️🚨 **[5x3 죽음의 낙인] 사(死)의 에너지 폭발! 444.4토큰 소멸!** 🚨👁️';
                } else if (row2Set.size === 1) { 
                    const sym = matrix[1][0];
                    if (sym === '7️⃣') { prize = 1200; resultText = '🔥👑 **[5x3 신화 잭팟] 중앙 77777 일렬 종대! (+1200토큰)** 👑🔥'; }
                    else if (sym === '💎') { prize = 800; resultText = '💎✨ **[5x3 전설 잭팟] 중앙 다이아몬드 라인! (+800토큰)** ✨💎'; }
                    else { prize = 400; resultText = `🎰 **[5x3 미들 잭팟] 중앙 가로라인 일치! (+400토큰)** 🎰`; }
                } else if (row1Set.size === 1 || row3Set.size === 1) { 
                    prize = 250; resultText = '🎉 **[5x3 사이드 라인] 상단 혹은 하단 한 줄 통일! (+250토큰)** 🎉';
                } else {
                    const corners = [matrix[0][0], matrix[0][4], matrix[2][0], matrix[2][4]];
                    if (new Set(corners).size === 1 && !corners.includes('4️⃣') && !corners.includes('6️⃣')) {
                        prize = 150; resultText = '🍀✨ **[5x3 모서리 크로스] 네 꼭짓점 문양 일치! (+150토큰)** ✨🍀';
                    } else {
                        const maxMatches = Math.max(...baseEmojis.map(e => allSymbols.filter(s => s === e).length));
                        if (maxMatches >= 6) { prize = 60; resultText = `📈 **[5x3 밀집 당첨] 한 종류 심볼 6개 이상 모임! (+60토큰)**`; }
                        else if (maxMatches >= 4) { prize = 20; resultText = `🎉 **[5x3 일반 당첨] 적당히 모인 심볼들! (+20토큰)**`; }
                        else { prize = 0; resultText = '😭 **[5x3 낙첨] 격자를 맞추지 못했습니다.** 😭'; }
                    }
                }

                return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);
            }
        } catch (err) { console.error(err); return message.reply("슬롯머신 구동 실패."); }
    }

    if (command === '!슬롯25') {
        try {
            const slotPrice = 25;
            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };

            if ((u.tokens ?? 200) < slotPrice) return message.reply(`❌ 토큰이 부족합니다!`);

            const baseEmojis = ['7️⃣', '💎', '🍀', '🍇', '🍊', '🍒', '🔔'];
            const chance666 = (u.p_666 ?? 1.0) / 100;
            const chance444 = (u.p_444 ?? 4.0) / 100;

            const hiddenBoard = Array.from({ length: 10 }, () => {
                const rand = Math.random();
                if (rand < chance666) return '6️⃣';
                if (rand < chance666 + chance444) return '4️⃣';
                return baseEmojis[Math.floor(Math.random() * baseEmojis.length)];
            });

            if (!client.slot25Data) client.slot25Data = new Map();
            client.slot25Data.set(userId, { hiddenBoard, timestamp: Date.now() });

            return message.reply(
                `🎲 **[슬롯25: 뒤집기 도박판]** 판돈 **25 토큰** 대기 완료.\n` +
                `아래 10개의 뒷면 카드 중 **3개의 번호**를 찍으세요!\n\n` +
                `1️⃣  2️⃣\n3️⃣  4️⃣\n5️⃣  6️⃣\n7️⃣  8️⃣\n9️⃣  🔟\n\n` +
                `👉 **입력 예시:** \`!1 5 8\` (공백 구분 3개)`
            );
        } catch (e) { return message.reply("슬롯25 생성 실패."); }
    }

    if (command && command.startsWith('!') && !isNaN(command.slice(1))) {
        try {
            if (!client.slot25Data || !client.slot25Data.has(userId)) return message.reply("❌ 먼저 \`!슬롯25\`를 실행하세요!");

            const firstNum = command.slice(1);
            const allNumbers = [firstNum, ...args];

            if (allNumbers.length !== 3) return message.reply("❌ 정확히 3개의 카드 번호를 입력하세요!");

            const chosenIndices = allNumbers.map(num => parseInt(num, 10) - 1);
            const isValid = chosenIndices.every(idx => idx >= 0 && idx < 10 && !isNaN(idx));
            const isUnique = new Set(chosenIndices).size === 3;

            if (!isValid || !isUnique) return message.reply("❌ 1부터 10 사이의 중복 없는 올바른 숫자를 고르세요.");

            const session = client.slot25Data.get(userId);
            client.slot25Data.delete(userId); 

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            const u = user || { tokens: 200, p_444: 4.0, p_666: 1.0 };

            const s1 = session.hiddenBoard[chosenIndices[0]];
            const s2 = session.hiddenBoard[chosenIndices[1]];
            const s3 = session.hiddenBoard[chosenIndices[2]];

            let prize = 0;
            let curseType = null;
            let resultText = '';
            const slotDisplay = `🎰 **선택 카드 뒤집기 결과:** [ ${s1} | ${s2} | ${s3} ]`;

            if (s1 === '6️⃣' && s2 === '6️⃣' && s3 === '6️⃣') {
                curseType = '666'; prize = -1500; resultText = '💀 **[슬롯25 대재앙] 6 6 6 리빌! 1500토큰 증발!** 💀';
            } else if (s1 === '4️⃣' && s2 === '4️⃣' && s3 === '4️⃣') {
                curseType = '444'; prize = -444.4; resultText = '👁️ **[슬롯25 사선 오픈] 4 4 4 금기 해제! 444.4토큰 소멸!** 👁️';
            } else if (s1 === s2 && s2 === s3) {
                if (s1 === '7️⃣') { prize = 1500; resultText = '🔥 **[슬롯25 신화 트리플] 777 저격 완료! (+1500토큰)** 🔥'; }
                else if (s1 === '💎') { prize = 900; resultText = '💎 **[슬롯25 쥬얼 트리플] 다이아 광맥 채굴! (+900토큰)** 💎'; }
                else { prize = 150; resultText = `🎰 **[슬롯25 일반 트리플] 트리플 라인! (+150토큰)** 🎰`; }
            } else if ((s1 === s2 || s2 === s3 || s1 === s3) && !['6️⃣','4️⃣'].includes(s1) && !['6️⃣','4️⃣'].includes(s2) && !['6️⃣','4️⃣'].includes(s3)) {
                prize = 300; resultText = '🎉 **[슬롯25 페어 매치] 방어 성공! (+30토큰)** 🎉';
            } else {
                prize = 0; resultText = '😭 **[슬롯25 낙첨] 카드들이 서로 엇갈렸습니다.** 😭';
            }

            const slotPrice = 25;
            return applySlotWinnings(message, userId, u, slotPrice, prize, resultText, slotDisplay, curseType);
        } catch (err) { console.error(err); return message.reply("슬롯25 처리 실패."); }
    }

    if (command === '!로또자동' || command === '!로또수동') {
        try {
            const isAuto = (command === '!로또자동');
            const lottoPrice = isAuto ? 55 : 50; 

            const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
            let currentTokens = user ? (user.tokens ?? 200) : 200;

            if (currentTokens < lottoPrice) return message.reply(`❌ 토큰 부족! 잔액: ${currentTokens} 토큰`);

            let userNumbers = [];
            if (isAuto) {
                while (userNumbers.length < 6) {
                    let num = Math.floor(Math.random() * 45) + 1;
                    if (!userNumbers.includes(num)) userNumbers.push(num);
                }
            } else {
                if (args.length !== 6) return message.reply(`❌ 번호 누락! \`!로또수동 3 12 24 33 39 45\` 형태로 입력하세요!`);
                userNumbers = args.map(Number);
                if (userNumbers.some(num => num < 1 || num > 45 || isNaN(num)) || new Set(userNumbers).size !== 6) {
                    return message.reply('❌ 올바르지 않은 번호입니다. (1~45 사이 중복 없는 숫자 6개)');
                }
            }
            userNumbers.sort((a, b) => a - b);

            let winningNumbers = [];
            while (winningNumbers.length < 6) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) winningNumbers.push(num);
            }
            winningNumbers.sort((a, b) => a - b);

            let bonusNumber;
            while (true) {
                let num = Math.floor(Math.random() * 45) + 1;
                if (!winningNumbers.includes(num)) { bonusNumber = num; break; }
            }

            const matchedCount = userNumbers.filter(num => winningNumbers.includes(num)).length;
            const isBonusMatched = userNumbers.includes(bonusNumber);

            let resultMessage = '😭 낙첨... 다음 회차에!';
            let prize = 0;

            if (matchedCount === 6) { resultMessage = '🎉 1등 대박 잭팟!!! 🎉'; prize = 5000; }
            else if (matchedCount === 5 && isBonusMatched) { resultMessage = '🥈 2등 보너스 적중!! 🥈'; prize = 1000; }
            else if (matchedCount === 5) { resultMessage = '🥉 3등 당첨! 고액 보상! 🥉'; prize = 500; }
            else if (matchedCount === 4) { resultMessage = '🏅 4등 당첨! 피자 값 확보! 🏅'; prize = 100; }
            else if (matchedCount === 3) { resultMessage = '◽ 5등 당첨! 본전 수거! ◽'; prize = 25; }

            const finalTokens = Math.floor(currentTokens - lottoPrice + prize);
            await supabase.from('attendance').update({ tokens: finalTokens }).eq('user_id', userId);

            return message.reply(
                `🎫 **인생역전 로또 영수증** 🎫\n` +
                `• 선택 방식: [ ${isAuto ? '자동 발급' : '수동 마킹'} ]\n` +
                `• 선택 번호: [ ${userNumbers.join(', ')} ]\n` +
                `• 당첨 번호: [ ${winningNumbers.join(', ')} ] + 보너스 [ ${bonusNumber} ]\n` +
                `-----------------------------------------\n` +
                `🎯 결과: ${resultMessage}\n` +
                `💸 판돈 차감: [ -${lottoPrice} 토큰 ]\n` +
                `🎁 당첨 보상: [ +${prize} 토큰 ]\n` +
                `💳 현재 잔액: ${finalTokens} 토큰`
            );
        } catch (err) { return message.reply("로또 구동 실패."); }
    }

    // 📋 정규 출근 체크 시스템
    if (!["출근", "근출", "출", "근", "出勤", "ㅊㄱ", "출첵", "출석", "attend", "근.", "출.", "출 ", "근 ", "출군", "앙", "아잉", "웅", "출근해떠염", "여자", "ㅊㅊ"].includes(commandBody)) return;

    if (currentHour >= 0 && currentHour < 4) return message.reply("🚫 지금은 출근 자금 세탁 금지 시간입니다!");

    try {
        const { data: user } = await supabase.from('attendance').select('*').eq('user_id', userId).maybeSingle();
        if (user && user.last_checkin === today) return message.reply(`오늘 이미 도장을 찍었습니다! ✨`);

        let earnedTokens = 10;
        if (currentHour < 14) earnedTokens = 20;
        else if (currentHour < 18) earnedTokens = 15;

        let newStreak = 1;
        if (user && user.last_checkin) {
            const formatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
            const parts = formatter.formatToParts(new Date());
            const yesterday = new Date(`${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}-${parts.find(p => p.type === 'day').value}T12:00:00+09:00`);
            yesterday.setDate(yesterday.getDate() - 1);
            if (user.last_checkin === yesterday.toISOString().split('T')[0]) newStreak = (user.streak || 0) + 1;
        }

        const totalTokens = Math.floor((user ? (user.tokens ?? 200) : 200) + earnedTokens);
        await supabase.from('attendance').upsert({
            user_id: userId, username: message.author.username,
            last_checkin: today, streak: newStreak, tokens: totalTokens,
            protection_cards: user ? (user.protection_cards ?? 0) : 0
        }, { onConflict: 'user_id' });

        return message.reply(`✅ **출근 체크 성공!** 현재 **${newStreak}일** 연속 달리는 중! 🔥\n💰 \`${earnedTokens} 토큰\` 지급 (총액: \`${totalTokens} 토큰\`)`);
    } catch (err) { return message.reply("⚠️ 출근 DB 처리 에러 발생!"); }
});

client.login(process.env.DISCORD_TOKEN);
